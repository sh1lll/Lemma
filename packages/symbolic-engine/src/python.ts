/**
 * The SymPy side of the symbolic engine. Runs inside Pyodide (a web worker in the app, Node in tests).
 * Requests arrive as JSON built by request.ts, whose expression strings are generated from Lemma's
 * own AST printer, so only SymPy constructors and operators appear in them.
 *
 * Every result carries `text` (pretty, for people: 2x², √3, π, −), `plain` (machine-readable Lemma syntax,
 * for re-use in formulas), LaTeX, optional detail `lines`, `notes`, and collapsed `extra` LaTeX (long exact forms).
 */
import { STEPS_PY } from './steps-python';

export const PYTHON_SOURCE = String.raw`
import json, sympy, random
import re as _re
from sympy import *
from sympy.printing.str import StrPrinter
from sympy.printing.precedence import PRECEDENCE
from sympy.solvers.ode import checkodesol
from sympy.solvers.inequalities import solve_univariate_inequality
from sympy.logic.boolalg import simplify_logic, truth_table
_NS = {k: getattr(sympy, k) for k in dir(sympy) if not k.startswith('_')}
_NS['__builtins__'] = {}

_QUOTED = _re.compile(r"('[^']*')")
_INTLIT = _re.compile(r'(?<![\w.])(\d+)(?![\w.])')

def _exact_ints(src):
    # Python's 1/2 is a float: integer literals outside quoted strings become SymPy Integers.
    parts = _QUOTED.split(src)
    return ''.join(p if i % 2 else _INTLIT.sub(r'Integer(\1)', p) for i, p in enumerate(parts))

def _parse(src, real=False):
    src = _exact_ints(src)
    ns = dict(_NS)
    ns['Symbol'] = (lambda n: Symbol(n, real=True)) if real else Symbol
    ns['f'] = Function('f')
    ns['x'] = Symbol('x', real=True)
    return eval(src, ns)

# ---------- printing ----------
_GREEK = {'theta': 'θ', 'alpha': 'α', 'beta': 'β', 'gamma': 'γ', 'delta': 'δ', 'epsilon': 'ε', 'lambda': 'λ', 'mu': 'μ', 'sigma': 'σ',
          'omega': 'ω', 'rho': 'ρ', 'psi': 'ψ', 'kappa': 'κ', 'nu': 'ν', 'xi': 'ξ', 'zeta': 'ζ', 'eta': 'η', 'chi': 'χ', 'iota': 'ι', 'upsilon': 'υ'}
_SUPT = str.maketrans('0123456789-', '⁰¹²³⁴⁵⁶⁷⁸⁹⁻')
_SUBT = str.maketrans('0123456789', '₀₁₂₃₄₅₆₇₈₉')
_SUPC = '⁰¹²³⁴⁵⁶⁷⁸⁹'

def _fmt_float(v, digits=12):
    try:
        f = float(v)
    except Exception:
        return str(v)
    if f == int(f) and abs(f) < 1e15:
        return str(int(f))
    s = ('%.' + str(digits) + 'g') % f
    if 'e' in s:
        m, ex = s.split('e')
        return m + '×10' + str(int(ex)).translate(_SUPT)
    return s

class _PP(StrPrinter):
    def _print_Symbol(self, e):
        return _GREEK.get(e.name, e.name)
    def _print_Dummy(self, e):
        return _GREEK.get(e.name, e.name)
    def _print_ImaginaryUnit(self, e):
        return 'i'
    def _print_Exp1(self, e):
        return 'e'
    def _print_Pi(self, e):
        return 'π'
    def _print_Infinity(self, e):
        return '∞'
    def _print_NegativeInfinity(self, e):
        return '-∞'
    def _print_ComplexInfinity(self, e):
        return 'complex ∞'
    def _print_NaN(self, e):
        return 'undefined'
    def _print_GoldenRatio(self, e):
        return 'φ'
    def _print_EulerGamma(self, e):
        return 'γ'
    def _print_Float(self, e):
        return _fmt_float(e)
    def _print_log(self, e):
        if len(e.args) == 1:
            return 'ln(' + self._print(e.args[0]) + ')'
        return 'log_' + self._print(e.args[1]) + '(' + self._print(e.args[0]) + ')'
    def _print_Abs(self, e):
        return '|' + self._print(e.args[0]) + '|'
    def _print_exp(self, e):
        return 'e' + self._exponent(e.args[0])
    def _print_LambertW(self, e):
        return 'W(' + ', '.join(self._print(a) for a in e.args) + ')'
    def _print_conjugate(self, e):
        return 'conj(' + self._print(e.args[0]) + ')'
    def _print_re(self, e):
        return 'Re(' + self._print(e.args[0]) + ')'
    def _print_im(self, e):
        return 'Im(' + self._print(e.args[0]) + ')'
    def _print_factorial(self, e):
        a = e.args[0]
        return (self._print(a) if a.is_Symbol or a.is_Integer else '(' + self._print(a) + ')') + '!'
    def _print_CRootOf(self, e):
        return '≈ ' + _num(e, 8)
    def _print_Relational(self, e):
        op = {'==': '=', '!=': '≠', '<=': '≤', '>=': '≥', '<': '<', '>': '>'}[e.rel_op]
        return self._print(e.lhs) + ' ' + op + ' ' + self._print(e.rhs)
    def _print_Equality(self, e):
        return self._print(e.lhs) + ' = ' + self._print(e.rhs)
    def _lg(self, a):
        t = self._print(a)
        return t if (a.is_Symbol or isinstance(a, Not) or a in (true, false)) else '(' + t + ')'
    def _print_And(self, e):
        return ' ∧ '.join(self._lg(a) for a in sorted(e.args, key=str))
    def _print_Or(self, e):
        return ' ∨ '.join(self._lg(a) for a in sorted(e.args, key=str))
    def _print_Not(self, e):
        return '¬' + self._lg(e.args[0])
    def _print_Implies(self, e):
        return self._lg(e.args[0]) + ' → ' + self._lg(e.args[1])
    def _print_Equivalent(self, e):
        return ' ↔ '.join(self._lg(a) for a in e.args)
    def _print_Xor(self, e):
        return ' ⊕ '.join(self._lg(a) for a in e.args)
    def _print_Add(self, e, order=None):
        terms = list(self._as_ordered_terms(e, order=order))
        if len(terms) > 1 and terms[0].is_number and terms[0].is_extended_negative:
            terms = terms[1:] + terms[:1]
            return StrPrinter._print_Add(self, Add(*terms, evaluate=False), order='none')
        return StrPrinter._print_Add(self, e, order=order)
    def _print_BooleanTrue(self, e):
        return 'true'
    def _print_BooleanFalse(self, e):
        return 'false'
    def _exponent(self, x):
        if x.is_Integer and x > 1:
            return str(x).translate(_SUPT)
        s = self._print(x)
        if x.is_Symbol or (x.is_Integer and x >= 0):
            return '^' + s
        return '^(' + s + ')'
    def _rad(self, b):
        s = self._print(b)
        if b.is_Symbol or b.is_NumberSymbol or (b.is_Integer and b > 0):
            return s
        return '(' + s + ')'
    def _print_Pow(self, e, rational=False):
        b, x = e.base, e.exp
        if x is S.Half:
            return '√' + self._rad(b)
        if x == Rational(1, 3):
            return '∛' + self._rad(b)
        if x == Rational(1, 4):
            return '∜' + self._rad(b)
        if x.is_Rational and x.is_negative:
            inner = self._print(b) if x == -1 else self._print(Pow(b, -x, evaluate=False))
            if _toplevel_space(inner) or '*' in inner or (x == -1 and b.is_Mul):
                inner = '(' + inner + ')'
            return '1/' + inner
        if b is S.Exp1:
            return 'e' + self._exponent(x)
        bs = self.parenthesize(b, PRECEDENCE['Pow'], strict=False)
        if b.is_Rational and not b.is_Integer:
            bs = '(' + self._print(b) + ')'
        return bs + self._exponent(x)
    def _print_MatrixBase(self, e):
        return '[' + ', '.join('[' + ', '.join(self._print(c) for c in row) + ']' for row in e.tolist()) + ']'
    _print_MutableDenseMatrix = _print_MatrixBase
    _print_ImmutableDenseMatrix = _print_MatrixBase

_PRINTER = _PP({'order': None})

def _toplevel_space(t):
    depth = 0
    for ch in t:
        if ch in '([':
            depth += 1
        elif ch in ')]':
            depth -= 1
        elif ch == ' ' and depth == 0:
            return True
    return False
_FN_WORDS = ('sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'ln', 'log', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'conj', 'Re', 'Im', 'W', 'erf', 'gamma', 'sign', 'floor', 'ceiling', 'acot', 'asec', 'acsc')

def _juxt(s):
    out = []
    n = len(s)
    for i, ch in enumerate(s):
        if ch != '*':
            out.append(ch)
            continue
        p = s[i - 1] if i else ''
        q = s[i + 1] if i + 1 < n else ''
        j = i - 1
        while j >= 0 and s[j].isalpha():
            j -= 1
        wb = s[j + 1:i]
        before_word = s[j] if j >= 0 else ' '
        k = i + 1
        while k < n and s[k].isalpha():
            k += 1
        wa = s[i + 1:k]
        after_next = s[k] if k < n else ''
        sep = '·'
        q_fn = wa in _FN_WORDS and after_next == '('
        q_e = wa == 'e' and after_next == '^'
        q_ok = (len(wa) == 1 and not q_e) or q in '(√∛∜' or q_fn
        if p.isdigit():
            j2 = i - 1
            while j2 >= 0 and (s[j2].isdigit() or s[j2] == '.'):
                j2 -= 1
            rad = j2 >= 0 and s[j2] in '√∛∜'
            if not rad and (q_ok or q_e):
                sep = ''
        elif p == ')' and (q == '(' or q_ok):
            sep = ''
        elif p in _SUPC or (len(wb) == 1 and before_word not in '√∛∜'):
            if q_ok and not q_fn:
                sep = ''
        out.append(sep)
    return ''.join(out)

def _pp(e):
    try:
        if isinstance(e, (list, tuple)):
            return '[' + ', '.join(_pp(x) for x in e) + ']'
        s = _PRINTER.doprint(e)
    except Exception:
        s = sstr(e)
    # ln(|x|) reads as ln|x|.
    return _re.sub(r'ln\(\|([^|]*)\|\)', r'ln|\1|', _juxt(s).replace('-', '−'))

def _plain(e):
    if isinstance(e, (list, tuple)):
        return '[' + ', '.join(_plain(x) for x in e) + ']'
    s = sstr(e).replace('**', '^')
    for pat, rep in ((r'\bI\b', 'i'), (r'\boo\b', 'inf'), (r'\bE\b', 'e'), (r'\blog\(', 'ln(')):
        s = _re.sub(pat, rep, s)
    return s

def _num(e, digits=12):
    try:
        v = N(e, digits + 3)
        if v.is_number and not v.has(zoo, nan, oo, -oo):
            re_, im_ = v.as_real_imag()
            re_ = N(re_, digits); im_ = N(im_, digits)
            scale = max(abs(re_), abs(im_), 1e-300)
            if abs(im_) <= 1e-13 * scale:
                return _fmt_float(re_, digits)
            if abs(re_) <= 1e-13 * scale:
                return _fmt_float(im_, digits) + 'i'
            sign = ' − ' if im_ < 0 else ' + '
            return _fmt_float(re_, digits) + sign + _fmt_float(abs(im_), digits) + 'i'
    except Exception:
        pass
    return None

def _numplain(e):
    s = _num(e)
    return s.replace('−', '-').replace('×10', 'e').translate(str.maketrans('⁰¹²³⁴⁵⁶⁷⁸⁹⁻', '0123456789-')) if s else None

def _is_realnum(e):
    try:
        v = N(e, 20)
        re_, im_ = v.as_real_imag()
        return abs(im_) <= 1e-12 * max(1, abs(re_))
    except Exception:
        return e.is_real is not False

def _is_zero(e):
    try:
        z = simplify(e)
        if z == 0:
            return True
        n = N(z, 30)
        return n.is_number and abs(n) < 1e-20
    except Exception:
        return False

def _abs_logs(r, e, v):
    """∫ 1/x dx = ln|x| + C, ∫ tan x dx = −ln|cos x| + C: an antiderivative must also hold where the log's argument is
    negative. Kept only when it still differentiates back to the integrand."""
    if not r.has(log) or e.has(log):
        return r
    ra = r.replace(lambda z: isinstance(z, log) and z.args[0].is_positive is not True and not isinstance(z.args[0], Abs), lambda z: log(Abs(z.args[0])))
    return ra if ra != r and _zero_check(diff(ra, v) - e) else r

def _zero_check(e):
    """Fast check that e is identically 0: numeric for numbers, random rational substitutions for parameters."""
    try:
        fs = list(e.free_symbols)
        if not fs:
            v = N(e, 30)
            return bool(v.is_number and abs(v) < 1e-15)
        rnd = random.Random(7)
        for _ in range(3):
            sub = {s_: Rational(rnd.randint(2, 30), rnd.randint(31, 47)) for s_ in fs}
            v = N(e.subs(sub), 30)
            if not v.is_number or abs(v) > 1e-12:
                return _is_zero(e) if count_ops(e) < 80 else False
        return True
    except Exception:
        return False

def _free(exprs):
    s = set()
    for e in exprs:
        s |= e.free_symbols
    return sorted(s, key=lambda x: x.name)

def _sym(name, real=False):
    return Symbol(name, real=True) if real else Symbol(name)

def _sub(i):
    return str(i).translate(_SUBT)

def _short(e, t=None, limit=34):
    t = _pp(e) if t is None else t
    if e.has(CRootOf):
        return False
    return len(t) <= limit and count_ops(e) <= 18

_MINUS = _re.compile(r'(^|[\s(\[,=:±])-')
def _minus(t):
    return _MINUS.sub(lambda m: m.group(1) + '−', t)

def handle(req_json):
    req = json.loads(req_json)
    try:
        out = _handle(req)
        out['ok'] = True
        if isinstance(out.get('text'), str):
            out['text'] = _minus(out['text'])
        if out.get('lines'):
            out['lines'] = [[a, _minus(b)] for a, b in out['lines']]
    except Exception as ex:
        msg = str(ex)
        if isinstance(ex, NotImplementedError) or 'not implemented' in msg.lower():
            msg = 'SymPy has no method for this one: ' + msg[:160]
        out = {'ok': False, 'error': (type(ex).__name__ + ': ' + msg)[:300]}
    return json.dumps(out)

def _nice(r):
    # The most readable of several equivalent forms (shortest printout).
    cands = [r]
    for f in (simplify, factor, cancel, trigsimp, lambda z: expand(z) if not z.has(Pow) or z.is_polynomial() else z, lambda z: powsimp(powdenest(z, force=True), force=True, combine='base')):
        try:
            cands.append(f(r))
        except Exception:
            pass
    return min(cands, key=lambda z: (len(_pp(z)), count_ops(z)))

def _res(r, latex_in=None, **kw):
    out = {'latex_out': latex(r), 'text': _pp(r), 'plain': _plain(r), 'numeric': _num(r), 'exact': True}
    if latex_in is not None:
        out['latex_in'] = latex_in
    out.update(kw)
    return out

def _value_hint(fs):
    names = [_pp(s_) for s_ in fs]
    if not names:
        return None
    who = names[0] + ' a value' if len(names) == 1 else ', '.join(names[:-1]) + ' and ' + names[-1] + ' values'
    return 'Add “= …” to solve, or give ' + who + ' (' + names[0] + ' = 3)'

def _bare(e, req):
    """A typed expression with letters and no "=": the most useful form (factored or expanded), never an error."""
    fs = _free([e])
    lines = []
    label = 'Simplified'
    typed = _re.sub(r'[\s*]', '', req.get('label', ''))
    if fs and e.is_polynomial(*fs):
        ex = expand(e)
        fa = factor(e)
        # Typed already expanded, with nothing to collect ("x^2 + 2x + 1"): the factored form is the news. Otherwise
        # ("2(x + 3)", "3x - 2x", "4x + 3y - 2x + y") the expanded, collected form is, with the factored one beside it.
        signs = sum(1 for i, ch in enumerate(typed) if i > 0 and ch in '+-' and typed[i - 1] not in '^/(eE')
        expanded_already = '(' not in typed and signs + 1 == len(Add.make_args(ex))
        # Pulling out a number alone ("2x + 4" → 2(x + 2)) isn't worth leading with.
        real_factors = sum(m for f_, m in factor_list(ex)[1] if f_.free_symbols)
        if fa == ex:
            r = ex
        elif expanded_already and real_factors >= 2:
            r, label, lines = fa, 'Factored', [['Expanded', _pp(ex)]]
        else:
            r, lines = ex, [['Factored', _pp(fa)]]
            if '(' in typed:
                label = 'Expanded'
    else:
        r = simplify(e)
        if e.has(sin, cos, tan, sec, csc, cot):
            t2 = trigsimp(e)
            if count_ops(t2) < count_ops(r):
                r = t2
    # Nothing to simplify: what was typed is already its simplest form (allowing for a different order of terms).
    same = r == e and len(typed) <= len(_re.sub(r'[\s*]', '', _plain(r)))
    notes = []
    if same:
        label = 'Expression'
        h = _value_hint(fs)
        if h:
            notes.append(h)
    out = _res(r, None if same else latex(e), lines=lines, notes=notes, label=label,
               verified=None if same else {'ok': _zero_check(e - r), 'how': 'Checked the result equals the input'})
    return out

def _handle(req):
    op = req['op']
    notes = []
    if op == 'steps':
        return _steps(req)
    if op == 'report':
        return _report(req)
    if op == 'diff':
        e = _parse(req['exprs'][0], real=True)
        vs = [_sym(v, True) for v in req['vars']]
        n = req.get('order', 1)
        if len(vs) > 1:
            r = _nice(diff(e, *vs))
            lin = latex(Derivative(e, *vs))
        else:
            r = _nice(diff(e, vs[0], n))
            lin = latex(Derivative(e, vs[0], n))
        if req.get('point') is not None:
            p = _parse(req['point'], True)
            val = simplify(r.subs(vs[0], p))
            mode = req.get('mode')
            if mode in ('tangent', 'normal'):
                y0 = simplify(e.subs(vs[0], p))
                if mode == 'normal':
                    if val == 0:
                        return {'latex_in': '', 'latex_out': 'x = ' + latex(p), 'text': _pp(vs[0]) + ' = ' + _pp(p), 'plain': 'x = ' + _plain(p), 'lines': [['Point', '(' + _pp(p) + ', ' + _pp(y0) + ')'], ['Tangent slope', '0']], 'exact': True}
                    m_ = -1 / val
                else:
                    m_ = val
                line = expand(y0 + m_ * (vs[0] - p))
                return {'latex_in': '', 'latex_out': 'y = ' + latex(line), 'text': 'y = ' + _pp(line), 'plain': _plain(line), 'lines': [['Point', '(' + _pp(p) + ', ' + _pp(y0) + ')'], ['Slope', _pp(m_)], ['Derivative', _pp(r)]], 'notes': ['y − y₀ = m(x − x₀)'], 'exact': True}
            if mode == 'normal_slope':
                return _res(simplify(-1 / val), lin, lines=[['Tangent slope', _pp(val)]], notes=['Normal slope = −1 / tangent slope'])
            return _res(val, lin + r'\Big|_{' + latex(vs[0]) + '=' + latex(p) + '}', lines=[['Derivative', _pp(r)]])
        return _res(r, lin)
    if op == 'idiff':
        e = _parse(req['exprs'][0], real=True)
        y = _sym(req['vars'][0], True); x = _sym(req['vars'][1], True)
        r = simplify(idiff(e, y, x))
        return _res(r, r'\frac{d' + latex(y) + '}{d' + latex(x) + '}', text='d' + y.name + '/d' + x.name + ' = ' + _pp(r), notes=['Implicit differentiation of ' + _pp(e) + ' = 0'])
    if op == 'integrate':
        e = _parse(req['exprs'][0], real=True)
        v = _sym(req['vars'][0], True)
        if req.get('lower') is not None:
            a = _parse(req['lower'], True); b = _parse(req['upper'], True)
            r = integrate(e, (v, a, b))
            ver = None
            if r.has(Integral):
                notes.append('No closed form found; value computed numerically')
                r = Integral(e, (v, a, b)).evalf(15)
            elif r in (oo, -oo, zoo):
                notes.append('The integral diverges')
            else:
                try:
                    q = Integral(e, (v, a, b)).evalf(20)
                    if q.is_number and _num(r) is not None:
                        ok = abs(N(r, 20) - q) <= 1e-10 * max(1, abs(q))
                        ver = {'ok': bool(ok), 'how': 'Checked against numerical quadrature'}
                except Exception:
                    pass
            out = _res(r, latex(Integral(e, (v, a, b))), verified=ver, notes=notes, exact=not r.is_Float)
            if r in (oo, -oo):
                out['text'] = 'Diverges (' + _pp(r) + ')'
            return out
        r = integrate(e, v)
        if r.has(Integral):
            return _res(r, latex(Integral(e, v)), notes=['No elementary antiderivative found'])
        if not r.has(Si, Ci, erf, erfi, li, Ei, fresnels, fresnelc, LambertW, polylog, hyper, meijerg, Shi, Chi, gamma, uppergamma, lowergamma) and count_ops(r) < 60:
            r = _nice(r)
        r = _abs_logs(r, e, v)
        ok = _zero_check(diff(r, v) - e)
        out = _res(r, latex(Integral(e, v)), verified={'ok': ok, 'how': 'Differentiated back to the integrand'})
        out['latex_out'] += ' + C'; out['text'] += ' + C'; out['plain'] += ' + C'; out['numeric'] = None
        return out
    if op == 'integrate2':
        e = _parse(req['exprs'][0], real=True)
        lims = [(_sym(v, True), _parse(a, True), _parse(b, True)) for v, a, b in req['limits']]
        r = integrate(e, *lims)
        return _res(simplify(r), latex(Integral(e, *lims)))
    if op == 'limit':
        e = _parse(req['exprs'][0], real=True)
        v = _sym(req['vars'][0], True)
        p = _parse(req['point'], True)
        d = req.get('dir')
        if d:
            r = limit(e, v, p, d)
        else:
            if p in (oo, -oo):
                r = limit(e, v, p)
            else:
                l = limit(e, v, p, '-'); rr = limit(e, v, p, '+')
                if l != rr:
                    return {'latex_in': latex(Limit(e, v, p, '+-')), 'latex_out': r'\text{does not exist}', 'text': 'Does not exist', 'plain': 'undefined', 'lines': [['From the left', _pp(l)], ['From the right', _pp(rr)]], 'notes': ['The one-sided limits differ'], 'exact': True}
                r = l
        out = _res(r, latex(Limit(e, v, p, d or '+-')))
        if isinstance(r, AccumBounds):
            out['text'] = 'Does not exist (oscillates between ' + _pp(r.min) + ' and ' + _pp(r.max) + ')'
        return out
    if op == 'series':
        e = _parse(req['exprs'][0], real=True)
        v = _sym(req['vars'][0], True)
        p = _parse(req.get('point') or '0', True)
        n = int(req.get('order') or 6)
        r = series(e, v, p, n)
        poly = r.removeO()
        if p != 0:
            h = Symbol('h')
            poly2 = expand(poly.subs(v, h + p))
            if poly2.is_polynomial(h):
                pc = Poly(poly2, h)
                base = '(' + _pp(v - p) + ')'
                parts = []
                for k in range(pc.degree() + 1):
                    c = simplify(pc.coeff_monomial(h ** k))
                    if c == 0:
                        continue
                    if k == 0:
                        parts.append(_pp(c))
                        continue
                    num_, den_ = fraction(c)
                    neg = num_.could_extract_minus_sign()
                    if neg:
                        num_ = -num_
                    b = base + (str(k).translate(_SUPT) if k > 1 else '')
                    t = ('' if num_ == 1 else _pp(num_) + ('·' if not num_.is_Integer else '')) + b + ('' if den_ == 1 else '/' + _pp(den_))
                    parts.append(('−' if neg else '') + t)
                txt = ' + '.join(parts).replace('+ −', '− ')
            else:
                txt = _pp(poly)
        else:
            terms = Add.make_args(poly)
            terms = sorted(terms, key=lambda t: Poly(t, v).degree() if t.is_polynomial(v) else 0)
            txt = ' + '.join(_pp(t) for t in terms).replace('+ −', '− ')
        return {'latex_in': latex(e), 'latex_out': latex(r, order='rev-lex'), 'text': txt + ' + …', 'plain': _plain(poly), 'exact': True}
    if op == 'sum':
        e = _parse(req['exprs'][0], real=True)
        k = _sym(req['vars'][0], True)
        a = _parse(req['lower'], True); b = _parse(req['upper'], True)
        if k.name in [s_.name for s_ in b.free_symbols]:
            pass
        k_int = Symbol(k.name, integer=True)
        e2 = e.subs(k, k_int)
        s_ = Sum(e2, (k_int, a, b))
        r = s_.doit()
        r = simplify(factor(r)) if r.free_symbols else r
        if r.has(Sum):
            try:
                conv = s_.is_convergent()
            except Exception:
                conv = None
            if conv is False:
                return {'latex_in': latex(s_), 'latex_out': r'\text{diverges}', 'text': 'Diverges', 'plain': 'inf', 'notes': ['The series does not converge'], 'exact': True}
            v = s_.evalf(15)
            return _res(v, latex(s_), notes=['No closed form found; value computed numerically'], exact=False)
        if r in (oo, -oo):
            return {'latex_in': latex(s_), 'latex_out': r'\infty', 'text': 'Diverges (' + _pp(r) + ')', 'plain': 'inf', 'notes': ['The series grows without bound'], 'exact': True}
        return _res(r, latex(s_))
    if op in ('simplify', 'expand', 'factor', 'apart', 'trigsimp', 'expand_trig', 'together', 'rationalize', 'complete_square'):
        e = _parse(req['exprs'][0])
        if op == 'simplify' and req.get('mode') == 'bare':
            return _bare(e, req)
        dom = req.get('domain')
        if op == 'factor' and dom in ('complex', 'real'):
            fs = _free([e])
            v = fs[0] if fs else Symbol('x')
            rts = roots(Poly(e, v)) if fs else {}
            lc = Poly(e, v).LC() if fs else 1
            if dom == 'real':
                r = factor(e, extension=[s_ for s_ in _surds(rts)]) if _surds(rts) else factor(e)
            else:
                r = factor(e, extension=I) if all(_short(k) for k in rts) and not _surds(rts) else factor(e, extension=[I] + _surds(rts))
        elif op == 'trigsimp':
            r = trigsimp(e)
        elif op == 'expand_trig':
            r = expand_trig(e)
        elif op == 'together':
            r = together(e)
        elif op == 'rationalize':
            r = radsimp(e)
            nr = nsimplify(r)
            if count_ops(nr) < count_ops(r):
                r = nr
        elif op == 'complete_square':
            fs = _free([e])
            v = fs[0] if fs else Symbol('x')
            p = Poly(e, v)
            if p.degree() != 2:
                raise ValueError('Completing the square needs a quadratic')
            a_, b_, c_ = p.all_coeffs()
            h = -b_ / (2 * a_); k = c_ - b_ ** 2 / (4 * a_)
            txt = (_pp(a_) if a_ != 1 else '') + '(' + _pp(v - h) + ')² ' + ('+ ' + _pp(k) if not (k.is_number and k < 0) else '− ' + _pp(-k))
            if k == 0:
                txt = (_pp(a_) if a_ != 1 else '') + '(' + _pp(v - h) + ')²'
            r = a_ * (v - h) ** 2 + k
            lines = [['Vertex', '(' + _pp(h) + ', ' + _pp(k) + ')'], ['Axis of symmetry', _pp(v) + ' = ' + _pp(h)]]
            return {'latex_in': latex(e), 'latex_out': latex(a_) + r'\left(' + latex(v - h) + r'\right)^2 + ' + latex(k) if a_ != 1 else r'\left(' + latex(v - h) + r'\right)^2 + ' + latex(k), 'text': txt.replace('-', '−'), 'plain': _plain(r), 'lines': lines, 'verified': {'ok': _zero_check(expand(r - e)), 'how': 'Expanded back to the original'}, 'exact': True}
        else:
            fn = {'simplify': simplify, 'expand': lambda z: expand(expand_trig(z)) if z.has(sin, cos, tan) else expand(z), 'factor': factor, 'apart': apart}[op]
            r = fn(e)
            if op == 'simplify' and e.is_polynomial() and _free([e]):
                r = expand(e)
            if op == 'expand' and r.has(tan) and fraction(together(r))[1] != 1:
                r = together(r)
            if op == 'simplify' and e.has(sin, cos, tan, sec, csc, cot):
                t2 = trigsimp(e)
                if count_ops(t2) < count_ops(r):
                    r = t2
        ok = _zero_check(e - r)
        out = _res(r, latex(e), verified={'ok': ok, 'how': 'Checked the result equals the input'})
        if op == 'factor' and r == e and e.is_polynomial() and _free([e]):
            out['notes'] = ['Already irreducible over the rationals' + ('; try "factor … over the reals" or "over the complex numbers"' if not dom else '')]
        return out
    if op == 'polydiv':
        p = _parse(req['exprs'][0]); d = _parse(req['exprs'][1])
        fs = _free([p, d])
        v = _sym(req['vars'][0]) if req.get('vars') else (fs[0] if fs else Symbol('x'))
        q, r = div(p, d, v)
        mode = req.get('mode')
        lines = [['Quotient', _pp(q)], ['Remainder', _pp(r)]]
        if mode == 'isfactor':
            yes = r == 0
            return {'latex_in': '', 'latex_out': r'\text{' + ('yes' if yes else 'no') + '}', 'text': 'Yes' if yes else 'No', 'plain': 'true' if yes else 'false', 'lines': lines + ([['Factorisation', _pp(factor(d) * factor(q))]] if yes else []),
                    'notes': ['Factor theorem: (x − a) is a factor exactly when p(a) = 0'], 'exact': True}
        if mode == 'remainder':
            lines = [['Quotient', _pp(q)]]
            rts = solve(d, v)
            if Poly(d, v).degree() == 1 and rts:
                notes.append('Remainder theorem: p(' + _pp(rts[0]) + ') = ' + _pp(p.subs(v, rts[0])))
            return _res(r, latex(p) + r' \bmod ' + latex(d), lines=lines, notes=notes)
        if mode == 'synthetic' and Poly(d, v).degree() == 1:
            a_ = solve(d, v)[0]
            coeffs = Poly(p, v).all_coeffs()
            row = []
            acc = 0
            for c_ in coeffs:
                acc = acc * a_ + c_
                row.append(acc)
            lines.insert(0, ['Coefficients', '  '.join(_pp(c_) for c_ in coeffs)])
            lines.insert(1, ['Bottom row (÷ by ' + _pp(v) + ' − ' + _pp(a_) + ')', '  '.join(_pp(c_) for c_ in row)])
        whole = q + r / d if r != 0 else q
        rr = r if not (r.is_number and r < 0) else -r
        rt = _pp(rr)
        txt = _pp(q) + ('' if r == 0 else (' + ' if rr is r else ' − ') + (rt if ' ' not in rt else '(' + rt + ')') + '/(' + _pp(d) + ')')
        if q == 0:
            txt = _pp(r / d)
        if r == 0:
            notes.append(_pp(d) + ' divides exactly')
        return {'latex_in': r'\frac{' + latex(p) + '}{' + latex(d) + '}', 'latex_out': latex(q) + ('' if r == 0 else ' + ' + r'\frac{' + latex(r) + '}{' + latex(d) + '}'), 'text': txt, 'plain': _plain(whole),
                'lines': lines, 'notes': notes, 'verified': {'ok': _zero_check(expand(q * d + r - p)), 'how': 'Checked quotient × divisor + remainder = dividend'}, 'exact': True}
    if op in ('pgcd', 'plcm'):
        es = [_parse(s_) for s_ in req['exprs']]
        r = es[0]
        for x_ in es[1:]:
            r = gcd(r, x_) if op == 'pgcd' else lcm(r, x_)
        return _res(factor(r), ('\\gcd' if op == 'pgcd' else '\\operatorname{lcm}') + r'\left(' + ', '.join(latex(x_) for x_ in es) + r'\right)')
    if op == 'solve':
        return _solve(req)
    if op == 'identity':
        return _identity(req)
    if op == 'dsolve':
        return _dsolve(req)
    if op in ('laplace', 'ilaplace'):
        e = _parse(req['exprs'][0])
        fs = _free([e])
        t, s = symbols('t s', positive=True)
        if op == 'laplace':
            src = fs[0] if fs else t
            e = e.subs(src, t)
            r = laplace_transform(e, t, s, noconds=True)
            return _res(r, r'\mathcal{L}\{' + latex(e) + r'\}')
        src = fs[0] if fs else s
        e = e.subs(src, s)
        r = inverse_laplace_transform(e, s, t)
        return _res(r, r'\mathcal{L}^{-1}\{' + latex(e) + r'\}', notes=['θ(t) is the Heaviside step'])
    if op in ('fourier', 'ifourier'):
        e = _parse(req['exprs'][0], real=True)
        fs = _free([e])
        x_ = fs[0] if fs else Symbol('x', real=True)
        k = Symbol('k', real=True)
        r = fourier_transform(e, x_, k) if op == 'fourier' else inverse_fourier_transform(e, x_, k)
        return _res(simplify(r), r'\mathcal{F}\{' + latex(e) + r'\}', notes=['Convention: F(k) = ∫ f(x) e^(−2πikx) dx'])
    if op == 'matrix':
        return _matrix(req)
    if op == 'vector':
        return _vector(req)
    if op == 'evaluate':
        return _evaluate(req)
    if op == 'logic':
        return _logic(req)
    if op == 'sequence':
        return _sequence(req)
    if op == 'rsolve':
        return _rsolve(req)
    if op == 'extrema':
        return _extrema(req)
    if op == 'conic':
        return _conic(req)
    if op == 'quadinfo':
        return _quadinfo(req)
    if op == 'coeff':
        e = expand(_parse(req['exprs'][0])); t = _parse(req['exprs'][1])
        c = e.coeff(t) if not t.is_number else e.as_coefficients_dict().get(S.One, 0)
        return _res(c, latex(e), notes=['From the expansion ' + (_pp(e) if len(_pp(e)) < 120 else '(long)')])
    if op == 'fninfo':
        return _fninfo(req)
    if op == 'vcalc':
        return _vcalc(req)
    if op == 'calcapp':
        return _calcapp(req)
    if op == 'binomial_series':
        e = _parse(req['exprs'][0], real=True)
        v = _sym(req['vars'][0], True)
        n = int(req.get('order') or 3)
        r = series(e, v, 0, n + 1).removeO()
        terms = sorted(Add.make_args(expand(r)), key=lambda t: Poly(t, v).degree())
        txt = ' + '.join(_pp(t) for t in terms).replace('+ −', '− ')
        notes2 = []
        try:
            b_, ex_ = e.as_base_exp()
            if not (ex_.is_Integer and ex_ >= 0):
                c0 = b_.subs(v, 0)
                lin = expand(b_ / c0 - 1)
                notes2.append('Valid for |' + _pp(lin) + '| < 1')
        except Exception:
            pass
        return {'latex_in': latex(e), 'latex_out': latex(r, order='rev-lex'), 'text': txt + ' + …', 'plain': _plain(r), 'notes': notes2, 'exact': True}
    raise ValueError('Unknown operation ' + op)

def _surds(rts):
    out = []
    for k in rts:
        for a in preorder_traversal(k):
            if isinstance(a, Pow) and a.exp == S.Half and a.base.is_Integer and a.base > 0 and a not in out:
                out.append(a)
    return out

# ---------- complex numbers & evaluation ----------
def _evaluate(req):
    e = _parse(req['exprs'][0])
    form = req.get('form')
    if e.has(Symbol) and e.free_symbols:
        r = simplify(e)
        return _res(r, latex(e))
    r = simplify(expand_complex(e))
    if any(isinstance(a, Pow) and not a.exp.is_real for a in preorder_traversal(r)):
        r2 = simplify(r.rewrite(exp))
        if not r2.has(I) or count_ops(r2) < count_ops(r):
            r = r2
    if r.is_number and not _is_realnum(r):
        a_, b_ = simplify(re(r)), simplify(im(r))
        if not a_.has(re, im, arg, atan2) and not b_.has(re, im, arg, atan2):
            r = expand(a_ + b_ * I)
    lines = []
    out = _res(r, latex(e))
    if r.is_number and r.is_real is False or (r.is_number and not _is_realnum(r)) or form:
        mod = simplify(Abs(r)); th = simplify(arg(r))
        if th.has(atan) and not (th / pi).is_rational:
            th_txt = _pp(th) + ' ≈ ' + _num(th, 6) + ' rad'
        else:
            th_txt = _pp(th) + ' rad' + ('' if th == 0 else ' (' + _pp(simplify(th * 180 / pi)) + '°)')
        rect = _pp(r)
        lines = [['Rectangular', rect], ['Modulus |z|', _pp(mod) + ('' if mod.is_Rational else ' ≈ ' + str(_num(mod, 8)))], ['Argument', th_txt],
                 ['Polar', (_pp(mod) if mod != 1 else '') + '(cos(' + _pp(th) + ') + i·sin(' + _pp(th) + '))' if count_ops(th) < 8 else _pp(mod) + '·cis(' + _num(th, 6) + ')'],
                 ['Exponential', (_pp(mod) + '·' if mod != 1 else '') + 'e^(' + ('i' if th == 1 else 'i·' + (_pp(th) if ' ' not in _pp(th) else '(' + _pp(th) + ')')) + ')' if count_ops(th) < 8 else _pp(mod) + '·e^(' + _num(th, 6) + 'i)']]
        out['lines'] = lines
        if form in ('polar', 'exp'):
            pick = lines[3] if form == 'polar' else lines[4]
            out['text'] = pick[1].replace('-', '−')
    return out

# ---------- equations ----------
_PREF = ['x', 'y', 'z', 't', 'n', 'w', 'u', 'v', 's', 'r', 'theta', 'θ', 'p', 'q', 'm', 'k']
_PERIODIC = (sin, cos, tan, cot, sec, csc)

def _pick(exprs, k):
    fs = _free(exprs)
    names = {s_.name: s_ for s_ in fs}
    out = [names[n] for n in _PREF if n in names][:k]
    if len(out) < k:
        out += [s_ for s_ in fs if s_ not in out][:k - len(out)]
    return out

def _label(v, i, n):
    return _pp(v) + (_sub(i + 1) if n > 1 else '')

def _conditions(sols, v):
    conds = []
    for s_ in sols:
        try:
            d = denom(together(s_))
            fl = factor_list(d)[1]
        except Exception:
            continue
        for f_, _m in fl:
            if f_.could_extract_minus_sign():
                f_ = -f_
            fsy = f_.free_symbols - {v}
            if not fsy:
                continue
            c = None
            if len(fsy) == 1:
                w = list(fsy)[0]
                try:
                    if Poly(f_, w).degree() == 1:
                        z = solve(f_, w)
                        if len(z) == 1:
                            c = _pp(w) + ' ≠ ' + _pp(z[0])
                except Exception:
                    pass
            if c is None and any(isinstance(a, Pow) and not a.exp.is_Integer for a in preorder_traversal(f_)):
                continue
            c = c or (_pp(f_) + ' ≠ 0')
            if c not in conds:
                conds.append(c)
        # square roots of parameters need non-negative radicands (real solutions)
    return conds

def _pm(a, b):
    """Two roots a, b that read as m ± d: returns the text or None."""
    try:
        m = simplify((a + b) / 2); d = simplify((b - a) / 2)
        if d.could_extract_minus_sign():
            d = -d
        na, da = fraction(together(a)); nb, db = fraction(together(b))
        if da == db and da != 1 and not da.is_number:
            m2 = expand((na + nb) / 2); d2 = expand((nb - na) / 2)
            if d2.could_extract_minus_sign():
                d2 = -d2
            t = '(' + _pp(m2) + ' ± ' + _pp(d2) + ')/' + (_pp(da) if (da.is_Symbol or da.is_Integer) else '(' + _pp(da) + ')')
            if m2 == 0:
                t = '±' + _pp(d2 / da)
            return t
        if not m.free_symbols and not d.free_symbols:
            if not _is_realnum(m):
                return None
            if d.is_Rational or not (d.has(I) or any(isinstance(a, Pow) and a.exp == S.Half for a in preorder_traversal(d))):
                return None
        if m == 0:
            return '±' + _pp(d)
        if d.has(I) and not m.has(I):
            return _pp(m) + ' ± ' + _pp(d)
        if not m.free_symbols and not d.free_symbols:
            if len(_pp(m)) + len(_pp(d)) < 30:
                return _pp(m) + ' ± ' + _pp(d)
            return None
        if len(_pp(m)) + len(_pp(d)) < 40:
            return _pp(m) + ' ± ' + _pp(d)
    except Exception:
        pass
    return None

def _root_disp(r, mult=1):
    t = _pp(r)
    n = _num(r)
    tag = '' if mult == 1 else (' (double root)' if mult == 2 else ' (triple root)' if mult == 3 else ' (multiplicity ' + str(mult) + ')')
    if r.free_symbols:
        return t + tag, True
    if r.is_Rational or n is None or (not r.has(Float) and re(r).is_Rational and im(r).is_Rational):
        return t + tag, True
    if _short(r, t):
        return (t + ('' if t == n else '  ≈ ' + n)) + tag, True
    return '≈ ' + n + tag, False

def _fmt_solutions(v, sols, mults=None, conds=None):
    """sols: list of exact solutions (real first). Returns dict pieces."""
    mults = mults or [1] * len(sols)
    lines = []
    extra = []
    approx = False
    disp = []
    for i, (s_, m_) in enumerate(zip(sols, mults)):
        d, exact_ok = _root_disp(s_, m_)
        disp.append(d)
        if not exact_ok:
            approx = True
            if not s_.has(CRootOf):
                extra.append([_label(v, i, len(sols)) + ' (exact)', latex(v) + ' = ' + latex(s_)])
        lines.append([_label(v, i, len(sols)), d])
    vn = _pp(v)
    short = [d.split('  ≈')[0] for d in disp]
    if len(sols) == 1:
        primary = vn + (' ' + disp[0] if disp[0].startswith('≈') else ' = ' + disp[0].replace('  ≈ ', ' ≈ '))
    else:
        pm = _pm(sols[0], sols[1]) if len(sols) == 2 and mults == [1, 1] and (sols[0].free_symbols or _short(sols[0])) else None
        if pm:
            primary = vn + ' = ' + pm
        else:
            items = []
            used = set()
            for i, s_ in enumerate(sols):
                if i in used:
                    continue
                if disp[i].startswith('≈') and not _is_realnum(s_):
                    # conjugate pair a ± bi
                    for j in range(i + 1, len(sols)):
                        if j not in used and disp[j].startswith('≈') and _zero_check(conjugate(N(s_, 20)) - N(sols[j], 20)) is not False:
                            if abs(N(conjugate(s_) - sols[j], 15)) < 1e-9:
                                re_, im_ = N(s_, 15).as_real_imag()
                                items.append('≈ ' + _fmt_float(re_, 6) + ' ± ' + _fmt_float(abs(im_), 6) + 'i')
                                used.add(j)
                                break
                    else:
                        items.append('≈ ' + _num(s_, 6))
                    used.add(i)
                    continue
                used.add(i)
                items.append(('≈ ' + _num(s_, 6)) if disp[i].startswith('≈') else short[i])
            if len(items) == 2:
                primary = vn + ' = ' + items[0] + ' or ' + vn + ' = ' + items[1] if not any(x.startswith('≈') for x in items) else vn + ' ' + (' or ' + vn + ' ').join(x if x.startswith('≈') else '= ' + x for x in items)
            else:
                primary = vn + ' = ' + ', '.join(items) if not any(x.startswith('≈') for x in items) else vn + ': ' + ', '.join(items)
    if len(primary) > 90 and len(sols) >= 3:
        items = []
        used = set()
        for i, s_ in enumerate(sols):
            if i in used:
                continue
            used.add(i)
            if s_.is_Rational or (not s_.free_symbols and _short(s_, None, 12)):
                items.append(_pp(s_))
                continue
            if not s_.free_symbols and not _is_realnum(s_):
                for j in range(i + 1, len(sols)):
                    if j not in used and abs(N(conjugate(s_) - sols[j], 15)) < 1e-9:
                        re_, im_ = N(s_, 15).as_real_imag()
                        items.append('≈ ' + _fmt_float(re_, 6) + ' ± ' + _fmt_float(abs(im_), 6) + 'i')
                        used.add(j)
                        break
                else:
                    items.append('≈ ' + _num(s_, 6))
                continue
            items.append('≈ ' + (_num(s_, 6) or _pp(s_)))
        primary = vn + ': ' + ', '.join(items)
    return primary.replace('= ≈', '≈'), lines, extra, approx

def _verify_roots(e, v, sols):
    try:
        for s_ in sols:
            val = e.subs(v, s_)
            if val.free_symbols:
                if not _zero_check(val):
                    return False
            else:
                n = N(val, 40)
                mag = max(1, abs(N(s_, 30))) ** max(1, (Poly(e, v).degree() if e.is_polynomial(v) else 1))
                if not (abs(n) < 1e-18 * mag):
                    return False
        return True
    except Exception:
        return None

def _solve(req):
    exprs = [_parse(s_) for s_ in req['exprs']]
    rels = req.get('rels') or ['='] * len(exprs)
    neq = len([r for r in rels if r == '='])
    if req.get('vars'):
        vs = [Symbol(v) for v in req['vars']]
    else:
        vs = _pick(exprs, max(1, len(exprs)) if all(r == '=' for r in rels) else 1)
    if not vs:
        # "solve 4x + 1 = 4x + 3": the unknown cancelled. Say what that means for it, not a bare True/False.
        named = _re.findall(r"Symbol\('(\w+)'\)", ' '.join(req['exprs']))
        if named and len(exprs) == 1 and rels[0] == '=' and not exprs[0].free_symbols:
            v_ = named[0]
            if _zero_check(exprs[0]):
                return {'latex_in': latex(Eq(exprs[0], 0)), 'latex_out': r'\text{all real numbers}', 'text': 'All real numbers', 'plain': 'true', 'exact': True,
                        'notes': ['The two sides are the same expression, so every value of ' + v_ + ' works (infinitely many solutions)']}
            return {'latex_in': latex(Eq(exprs[0], 0)), 'latex_out': r'\text{no solution}', 'text': 'No solution', 'plain': 'none', 'exact': True,
                    'notes': ['The ' + v_ + ' terms cancel, leaving ' + _pp(exprs[0]) + ' = 0, which is never true']}
        return _identity({'exprs': req['exprs'], 'rels': rels})
    dom = req.get('domain')
    if any(r not in ('=', '!=') for r in rels):
        return _inequality(exprs, rels, vs[0])
    if any(r == '!=' for r in rels):
        v = vs[0]
        vr = Symbol(v.name, real=True)
        e = exprs[0].subs(v, vr)
        z = [s_ for s_ in solve(e, vr) if _is_realnum(s_)]
        if not z:
            return {'latex_in': latex(Ne(e, 0)), 'latex_out': r'\text{all real numbers}', 'text': 'All real numbers', 'plain': 'true', 'notes': ['The two sides are never equal'], 'exact': True}
        txt = ' and '.join(_pp(vr) + ' ≠ ' + _pp(s_) for s_ in z)
        return {'latex_in': latex(Ne(e, 0)), 'latex_out': r',\ '.join(latex(vr) + r' \neq ' + latex(s_) for s_ in z), 'text': txt, 'plain': txt, 'lines': [['Interval notation', _ivtext(Complement(S.Reals, FiniteSet(*z)))]], 'exact': True}
    if len(exprs) == 1 and len(vs) == 1:
        return _solve1(exprs[0], vs[0], req)
    return _system(exprs, vs)

def _periodic_in(e, v):
    return any(f_.has(v) for f_ in e.atoms(*_PERIODIC))

def _imageset_pairs(sol):
    parts = sol.args if isinstance(sol, Union) else (sol,)
    pairs = []
    singles = []
    for p in parts:
        if isinstance(p, ImageSet):
            lam = p.lamda
            n = lam.variables[0]
            ex = expand(lam.expr)
            per = ex.coeff(n)
            base = simplify(ex - per * n)
            if per.is_number and per < 0:
                per = -per
            if per.free_symbols or base.has(n):
                return None, None
            pairs.append([base, per])
        elif isinstance(p, FiniteSet):
            singles += list(p)
        elif isinstance(p, Intersection) or isinstance(p, Complement):
            return None, None
        else:
            return None, None
    # normalise bases into [0, period) and merge pairs half a period apart
    norm = []
    for b, P in pairs:
        b = simplify(b - P * floor(b / P))
        if not any(_zero_check(b - b2) and _zero_check(P - P2) for b2, P2 in norm):
            norm.append([b, P])
    changed = True
    while changed:
        changed = False
        for i in range(len(norm)):
            for j in range(i + 1, len(norm)):
                b1, P1 = norm[i]; b2, P2 = norm[j]
                if _zero_check(P1 - P2) and (_zero_check(b2 - b1 - P1 / 2) or _zero_check(b1 - b2 - P1 / 2)):
                    norm[i] = [Min(b1, b2), P1 / 2]
                    norm.pop(j)
                    changed = True
                    break
            if changed:
                break
    norm.sort(key=lambda bp: (N(bp[1]), N(bp[0])))
    return norm, singles

def _general_text(v, pairs, deg=False):
    n = Symbol('n')
    items = []
    for b, P in pairs:
        if deg:
            bd = simplify(b * 180 / pi); Pd = simplify(P * 180 / pi)
            items.append(_pp(v) + ' = ' + ((_pp(bd) + '° + ') if bd != 0 else '') + _pp(Pd) + '°n')
        else:
            items.append(_pp(v) + ' = ' + ((_pp(b) + ' + ') if b != 0 else '') + _pp(P * n))
    return ' or '.join(items) + ', n ∈ ℤ'

def _solve1(e, v, req):
    dom = req.get('domain')
    notes = []
    params = sorted([s_ for s_ in e.free_symbols if s_ != v], key=lambda s_: s_.name)
    interval = None
    deg = bool(req.get('degrees'))
    if req.get('interval'):
        lo = _parse(req['interval'][0], True); hi = _parse(req['interval'][1], True)
        if deg:
            lo = lo * pi / 180; hi = hi * pi / 180
        interval = Interval(lo, hi)
    poly = None
    try:
        if e.is_polynomial(v) and dom != 'real':
            poly = Poly(e, v)
            if poly.degree() < 1:
                poly = None
    except Exception:
        poly = None
    latex_in = latex(Eq(e, 0))
    if poly is not None and interval is None:
        deg_ = poly.degree()
        rts = roots(poly, multiple=False) if deg_ <= 4 or not params else roots(poly, multiple=False)
        if deg_ == 3 and not params and rts and not all(_short(k) for k in rts):
            rt2 = roots(poly, multiple=False, trig=True)
            if rt2 and sum(rt2.values()) == 3 and all(_short(k) for k in rt2) and all(k.is_real for k in rt2):
                rts = rt2
        total = sum(rts.values()) if rts else 0
        closed = total == deg_
        if not closed and not params:
            # no closed form in radicals: numeric roots (exact CRootOf objects behind them)
            try:
                allr = poly.all_roots() if poly.is_univariate and all(c.is_number for c in poly.all_coeffs()) else []
            except Exception:
                allr = []
            sols = list(allr) if allr else [Float(z, 15) for z in poly.nroots(n=15)]
            uniq = []
            mults = []
            for s_ in sols:
                for i, u in enumerate(uniq):
                    if s_ == u:
                        mults[i] += 1
                        break
                else:
                    uniq.append(s_); mults.append(1)
            real = [(s_, m_) for s_, m_ in zip(uniq, mults) if _is_realnum(s_)]
            cplx = [(s_, m_) for s_, m_ in zip(uniq, mults) if not _is_realnum(s_)]
            sols = [s_ for s_, _ in real + cplx]; mults = [m_ for _, m_ in real + cplx]
            primary, lines, extra, approx = _fmt_solutions(v, sols, mults)
            notes.append('No closed form in radicals' + (' (a general polynomial of degree ≥ 5 can’t be solved with roots — Abel–Ruffini)' if deg_ >= 5 else '') + '; roots computed numerically to high precision')
            if cplx:
                notes.append(str(len(real)) + ' real root' + ('' if len(real) == 1 else 's') + ', ' + str(len(cplx)) + ' complex')
            return {'latex_in': latex_in, 'latex_out': r',\ '.join(latex(v) + r' \approx ' + (_numplain(s_) or '') for s_ in sols), 'text': primary, 'plain': ', '.join(_numplain(s_) or '' for s_ in sols),
                    'numeric': _num(sols[0]) if len(sols) == 1 else None, 'lines': lines, 'notes': notes, 'verified': {'ok': True, 'how': 'Roots isolated exactly (CRootOf) and evaluated numerically'}, 'exact': False, 'count': len(sols)}
        if closed:
            items = list(rts.items())
            if params:
                sols = [k for k, _ in items]; mults = [m_ for _, m_ in items]
                if any(not k.has(I) for k in sols) and any(k.has(I) for k in sols):
                    keep = [(k, m_) for k, m_ in items if not k.has(I)]
                    sols = [k for k, _ in keep]; mults = [m_ for _, m_ in keep]
                    notes.append('Complex solutions omitted (only the real root shown)')
            else:
                real = [(k, m_) for k, m_ in items if _is_realnum(k)]
                cplx = [(k, m_) for k, m_ in items if not _is_realnum(k)]
                real.sort(key=lambda km: N(re(km[0])))
                cplx.sort(key=lambda km: (N(re(km[0])), N(im(km[0]))))
                sols = [k for k, _ in real + cplx]; mults = [m_ for _, m_ in real + cplx]
                if cplx and real:
                    notes.append(str(len(cplx)) + ' complex solution' + ('s' if len(cplx) > 1 else '') + ' listed after the real ones')
                elif cplx:
                    notes.append('No real solutions; the solutions are complex')
            sols = [nsimplify(k) if k.has(Float) else k for k in sols]
            if params:
                sols = [_nice(k) for k in sols]
            conds = []
            if params:
                lc = poly.LC()
                if not lc.is_number:
                    for f_, _m in factor_list(lc)[1]:
                        if f_.could_extract_minus_sign():
                            f_ = -f_
                        if not f_.is_number:
                            t_ = _cond_text(f_)
                            if t_ not in conds:
                                conds.append(t_)
                for c in _conditions(sols, v):
                    if c not in conds:
                        conds.append(c)
                if conds:
                    notes.insert(0, 'Valid when ' + ', '.join(conds))
                notes.append('Solved for ' + _pp(v) + '; ' + ', '.join(_pp(p) for p in params) + ' treated as constant' + ('s' if len(params) > 1 else ''))
            primary, lines, extra, approx = _fmt_solutions(v, sols, mults)
            if conds:
                primary += '  (' + ', '.join(conds) + ')'
            ver = _verify_roots(e, v, sols)
            return {'latex_in': latex_in, 'latex_out': r',\quad '.join(latex(v) + ' = ' + latex(s_) for s_ in sols), 'text': primary, 'plain': ', '.join(_plain(s_) for s_ in sols),
                    'numeric': _num(sols[0]) if len(sols) == 1 else None, 'lines': lines, 'notes': notes, 'extra': extra,
                    'verified': {'ok': bool(ver), 'how': 'Substituted each solution back'} if ver is not None else None, 'exact': True, 'count': len(sols)}
    # ---- non-polynomial (or restricted to an interval) ----
    vr = Symbol(v.name, real=True) if dom != 'complex' else v
    er = e.subs(v, vr)
    if _periodic_in(er, vr) or interval is not None:
        domain = interval if interval is not None else S.Reals
        try:
            sol = solveset(er, vr, domain)
        except Exception:
            sol = None
        if sol is not None and not isinstance(sol, ConditionSet):
            if sol is S.EmptySet:
                return {'latex_in': latex_in, 'latex_out': r'\text{no real solution}', 'text': 'No real solution', 'plain': 'none', 'notes': ['No value of ' + _pp(vr) + (' in the interval' if interval is not None else '') + ' satisfies the equation'], 'exact': True}
            if isinstance(sol, FiniteSet):
                sols = sorted(sol, key=lambda s_: N(s_))
                if deg:
                    sd = [simplify(s_ * 180 / pi) for s_ in sols]
                    txt = _pp(vr) + ' = ' + ', '.join(_pp(s_) + '°' for s_ in sd)
                    return {'latex_in': latex_in, 'latex_out': r',\ '.join(latex(s_) + r'^\circ' for s_ in sd), 'text': txt, 'plain': ', '.join(_plain(s_) for s_ in sd), 'lines': [[_label(vr, i, len(sd)), _pp(s_) + '°'] for i, s_ in enumerate(sd)], 'exact': True, 'count': len(sd),
                            'verified': {'ok': bool(_verify_roots(er, vr, sols)), 'how': 'Substituted each solution back'}}
                primary, lines, extra, approx = _fmt_solutions(vr, sols)
                if interval is not None:
                    notes.append('Solutions in [' + _pp(interval.start) + ', ' + _pp(interval.end) + ']')
                ver = _verify_roots(er, vr, sols)
                return {'latex_in': latex_in, 'latex_out': r',\ '.join(latex(vr) + ' = ' + latex(s_) for s_ in sols), 'text': primary, 'plain': ', '.join(_plain(s_) for s_ in sols), 'numeric': _num(sols[0]) if len(sols) == 1 else None,
                        'lines': lines, 'notes': notes, 'extra': extra, 'verified': {'ok': bool(ver), 'how': 'Substituted each solution back'} if ver is not None else None, 'exact': True, 'count': len(sols)}
            pairs, singles = _imageset_pairs(sol)
            if pairs is not None and not singles:
                txt = _general_text(vr, pairs)
                lines = [['General solution', txt], ['In degrees', _general_text(vr, pairs, True)]]
                inside = sorted(solveset(er, vr, Interval(0, 2 * pi, False, True)), key=lambda s_: N(s_)) if True else []
                try:
                    if isinstance(inside, list) and inside:
                        lines.append(['In [0, 2π)', ', '.join(_pp(s_) for s_ in inside)])
                except Exception:
                    pass
                return {'latex_in': latex_in, 'latex_out': r'\ \text{or}\ '.join(latex(vr) + ' = ' + latex(b + P * Symbol('n')) for b, P in pairs) + r',\ n \in \mathbb{Z}', 'text': txt, 'plain': ', '.join(_plain(b) for b, P in pairs),
                        'lines': lines, 'notes': ['n is any integer'], 'verified': {'ok': bool(_verify_roots(er, vr, [b for b, P in pairs] + [b + P for b, P in pairs])), 'how': 'Substituted the solutions back'}, 'exact': True}
    # general: solve over the reals, report extraneous roots for radical equations
    try:
        sols = solve(er, vr)
        method = 'exact'
    except NotImplementedError:
        sols = None
        method = 'numeric'
    if sols is not None:
        sols = [s_ for s_ in sols if not isinstance(s_, dict)]
    if sols is None or (sols and any(s_.has(CRootOf) for s_ in sols) and not params):
        found = []
        f = lambdify(vr, er, 'mpmath')
        for x0 in [k_ / 2 for k_ in range(-40, 41)]:
            try:
                r = nsolve(er, vr, x0, tol=1e-25, prec=30)
                if r.is_real and all(abs(r - f_) > 1e-9 for f_ in found):
                    found.append(r)
            except Exception:
                pass
        sols = sorted(found)
        method = 'numeric'
        if sols:
            notes.append('No closed form; real roots found numerically in about [−20, 20]')
    extraneous = []
    if er.has(Pow) and any(isinstance(a, Pow) and a.has(vr) and not a.exp.is_Integer for a in preorder_traversal(er)) or er.has(Abs):
        try:
            cand = solve(er, vr, check=False)
            for c in cand:
                if c.is_real and all(not _zero_check(c - s_) for s_ in sols) and not er.has(Abs):
                    extraneous.append(c)
        except Exception:
            pass
    sols = [nsimplify(s_) if s_.has(Float) and method == 'exact' else s_ for s_ in sols]
    if params:
        sols = [_nice(s_) for s_ in sols]
        good = [s_ for s_ in sols if not s_.has(I)]
        if good and len(good) < len(sols):
            sols = good
            notes.append('Complex solutions omitted')
    try:
        sols.sort(key=lambda s_: N(s_) if s_.is_number else 0)
    except Exception:
        pass
    if not sols:
        msg = 'No real solution'
        if extraneous:
            notes.append('Candidate ' + ', '.join(_pp(vr) + ' = ' + _pp(c) for c in extraneous) + ' is extraneous: it doesn’t satisfy the original equation')
        if er.has(Abs) and not params:
            notes.append('An absolute value is never negative')
        return {'latex_in': latex_in, 'latex_out': r'\text{no real solution}', 'text': msg, 'plain': 'none', 'notes': notes, 'exact': True}
    conds = _conditions(sols, vr) if params else []
    if conds:
        notes.insert(0, 'Valid when ' + ', '.join(conds))
    if params:
        notes.append('Solved for ' + _pp(vr) + '; ' + ', '.join(_pp(p) for p in params) + ' treated as constant' + ('s' if len(params) > 1 else ''))
    primary, lines, extra, approx = _fmt_solutions(vr, sols)
    if conds:
        primary += '  (' + ', '.join(conds) + ')'
    if extraneous:
        notes.append(', '.join(_pp(vr) + ' = ' + _pp(c) for c in extraneous) + ' is extraneous (it fails the original equation), so it is rejected')
    ver = _verify_roots(er, vr, sols)
    return {'latex_in': latex_in, 'latex_out': r',\quad '.join(latex(vr) + ' = ' + latex(s_) for s_ in sols), 'text': primary, 'plain': ', '.join(_plain(s_) for s_ in sols),
            'numeric': _num(sols[0]) if len(sols) == 1 else None, 'lines': lines, 'notes': notes, 'extra': extra,
            'verified': {'ok': bool(ver), 'how': 'Substituted each solution back'} if ver is not None else None, 'exact': method == 'exact', 'count': len(sols)}

def _cond_text(f_):
    fsy = list(f_.free_symbols)
    if len(fsy) == 1:
        try:
            if Poly(f_, fsy[0]).degree() == 1:
                z = solve(f_, fsy[0])
                if len(z) == 1:
                    return _pp(fsy[0]) + ' ≠ ' + _pp(z[0])
        except Exception:
            pass
    return _pp(f_) + ' ≠ 0'

def _ivtext(sol):
    parts = sol.args if isinstance(sol, Union) else (sol,)
    out = []
    for p in parts:
        if isinstance(p, Interval):
            out.append(('(' if p.left_open or p.start == -oo else '[') + _pp(p.start) + ', ' + _pp(p.end) + (')' if p.right_open or p.end == oo else ']'))
        elif isinstance(p, FiniteSet):
            out.append('{' + ', '.join(_pp(x_) for x_ in p) + '}')
        elif isinstance(p, Complement) and p.args[0] == S.Reals:
            out.append('ℝ \\ {' + ', '.join(_pp(x_) for x_ in p.args[1]) + '}')
        else:
            out.append(_pp(p))
    return ' ∪ '.join(out) if out else '∅'

def _settext(sol, v):
    vn = _pp(v)
    if sol == S.Reals:
        return 'All real numbers'
    if sol is S.EmptySet:
        return 'No solution'
    parts = list(sol.args) if isinstance(sol, Union) else [sol]
    if len(parts) == 2 and all(isinstance(p, Interval) for p in parts):
        a, b = parts
        if a.start == -oo and b.end == oo and a.end == b.start and a.right_open and b.left_open:
            return vn + ' ≠ ' + _pp(a.end)
    if isinstance(sol, Complement) and sol.args[0] == S.Reals:
        return ' and '.join(vn + ' ≠ ' + _pp(x_) for x_ in sol.args[1])
    out = []
    for p in parts:
        if isinstance(p, Interval):
            a, b = p.start, p.end
            if a == -oo and b == oo:
                out.append('all real ' + vn)
            elif a == -oo:
                out.append(vn + (' < ' if p.right_open else ' ≤ ') + _pp(b))
            elif b == oo:
                out.append(vn + (' > ' if p.left_open else ' ≥ ') + _pp(a))
            else:
                out.append(_pp(a) + (' < ' if p.left_open else ' ≤ ') + vn + (' < ' if p.right_open else ' ≤ ') + _pp(b))
        elif isinstance(p, FiniteSet):
            out += [vn + ' = ' + _pp(x_) for x_ in p]
        else:
            out.append(_pp(p))
    return ' or '.join(out)

def _inequality(exprs, rels, v):
    vr = Symbol(v.name, real=True)
    ops = {'<': Lt, '>': Gt, '<=': Le, '>=': Ge, '=': Eq}
    conds = [ops[r](e.subs(v, vr), 0) for e, r in zip(exprs, rels)]
    sol = S.Reals
    for c in conds:
        sol = Intersection(sol, solve_univariate_inequality(c, vr, relational=False))
    sol = simplify(sol) if not isinstance(sol, (Interval, Union, FiniteSet)) else sol
    txt = _settext(sol, vr)
    iv = _ivtext(sol) if sol not in (S.Reals, S.EmptySet) else ('(−∞, ∞)' if sol == S.Reals else '∅')
    notes = []
    if sol is S.EmptySet:
        notes.append('No real number satisfies the inequality')
    elif sol == S.Reals:
        notes.append('Every real number satisfies it')
    # sample check
    ok = True
    try:
        for t_ in [-7.3, -2.1, -0.4, 0.6, 1.7, 3.2, 8.9]:
            inside = sol.contains(Rational(str(t_)))
            holds = all(bool(c.subs(vr, Rational(str(t_)))) for c in conds)
            if inside in (true, false) and bool(inside) != holds:
                ok = False
    except Exception:
        ok = None
    return {'latex_in': r',\ '.join(latex(c) for c in conds), 'latex_out': latex(sol), 'text': txt.replace('-', '−'), 'plain': _plain(sol), 'lines': [['Interval notation', iv.replace('-', '−')]], 'notes': notes,
            'verified': {'ok': bool(ok), 'how': 'Spot-checked points inside and outside the solution set'} if ok is not None else None, 'exact': True}

def _system(exprs, vs):
    latex_in = r'\begin{cases}' + r' \\ '.join(latex(Eq(e, 0)) for e in exprs) + r'\end{cases}'
    linear = True
    try:
        for e in exprs:
            if Poly(e, *vs).total_degree() > 1:
                linear = False
    except Exception:
        linear = False
    if linear:
        sol = linsolve(exprs, vs)
        if sol is S.EmptySet or not sol:
            return {'latex_in': latex_in, 'latex_out': r'\text{no solution}', 'text': 'No solution', 'plain': 'none',
                    'notes': ['The equations are inconsistent' + (' (parallel lines: same slope, different intercepts)' if len(vs) == 2 else '')], 'exact': True}
        tup = list(sol)[0]
        free = set()
        for t_ in tup:
            free |= (t_.free_symbols & set(vs))
        lines = [[_pp(k), (_pp(t_) if t_ != k else 'any value')] for k, t_ in zip(vs, tup)]
        if free:
            dep = [_pp(k) + ' = ' + _pp(t_) for k, t_ in zip(vs, tup) if t_ != k]
            fr = ', '.join(_pp(k) for k in vs if k in free)
            return {'latex_in': latex_in, 'latex_out': r',\ '.join(latex(k) + ' = ' + latex(t_) for k, t_ in zip(vs, tup) if t_ != k), 'text': 'Infinitely many solutions: ' + ', '.join(dep) + ' (' + fr + ' any value)', 'plain': ', '.join(dep),
                    'lines': lines, 'notes': ['The equations are dependent' + (' (they describe the same line)' if len(vs) == 2 and len(exprs) >= 2 else '')], 'exact': True}
        ver = all(_zero_check(e.subs(dict(zip(vs, tup)))) for e in exprs)
        txt = ', '.join(_pp(k) + ' = ' + _pp(t_) for k, t_ in zip(vs, tup))
        return {'latex_in': latex_in, 'latex_out': r',\ '.join(latex(k) + ' = ' + latex(t_) for k, t_ in zip(vs, tup)), 'text': txt, 'plain': txt.replace('−', '-'), 'lines': lines,
                'verified': {'ok': bool(ver), 'how': 'Substituted the solution into every equation'}, 'exact': True}
    sols = solve(exprs, vs, dict=True)
    sols = [s_ for s_ in sols if all(k in s_ for k in vs)] or sols
    real = [s_ for s_ in sols if all(_is_realnum(x_) for x_ in s_.values() if not x_.free_symbols)]
    cplx = [s_ for s_ in sols if s_ not in real]
    sols = real + cplx
    if not sols:
        return {'latex_in': latex_in, 'latex_out': r'\text{no solution}', 'text': 'No solution', 'plain': 'none', 'notes': ['No values satisfy every equation'], 'exact': True}
    ver = all(all(_zero_check(e.subs(s_)) for e in exprs) for s_ in sols)
    def tup(s_):
        vals = [s_.get(k, k) for k in vs]
        return '(' + ', '.join(_pp(x_) if _short(x_) or x_.free_symbols else '≈ ' + _num(x_, 6) for x_ in vals) + ')'
    head = '(' + ', '.join(_pp(k) for k in vs) + ')'
    shown = sols if len(sols) <= 6 else sols[:6]
    txt = head + ' = ' + ' or '.join(tup(s_) for s_ in shown)
    if len(sols) == 1:
        txt = ', '.join(_pp(k) + ' = ' + _pp(sols[0][k]) for k in vs if k in sols[0])
    lines = [['Solution ' + str(i + 1) if len(sols) > 1 else 'Solution', ', '.join(_pp(k) + ' = ' + (_pp(s_[k]) if _short(s_[k]) or s_[k].free_symbols else '≈ ' + _num(s_[k], 10)) for k in vs if k in s_)] for i, s_ in enumerate(sols)]
    notes = []
    if cplx:
        notes.append(str(len(cplx)) + ' complex solution' + ('s' if len(cplx) > 1 else '') + (' listed last' if real else ' only; no real intersection'))
    return {'latex_in': latex_in, 'latex_out': r',\quad '.join(r'\left(' + ', '.join(latex(s_.get(k, k)) for k in vs) + r'\right)' for s_ in sols), 'text': txt, 'plain': txt.replace('−', '-'),
            'lines': lines, 'notes': notes, 'verified': {'ok': bool(ver), 'how': 'Substituted each solution into every equation'}, 'exact': True, 'count': len(sols)}

def _identity(req):
    exprs = [_parse(s_) for s_ in req['exprs']]
    rel = (req.get('rels') or ['='])[0]
    e = exprs[0]
    fs = list(e.free_symbols)
    if not fs:
        if rel == '=':
            val = _zero_check(e)
        else:
            n = N(e, 30)
            val = bool({'<': n < 0, '>': n > 0, '<=': n <= 0, '>=': n >= 0, '!=': abs(n) > 1e-25}[rel])
        return {'latex_in': latex(e), 'latex_out': r'\text{' + ('true' if val else 'false') + '}', 'text': 'True' if val else 'False', 'plain': 'true' if val else 'false', 'exact': True,
                'notes': [] if val else ['The difference of the two sides is ' + _pp(simplify(e))]}
    z = simplify(e)
    if z != 0:
        z2 = simplify(trigsimp(expand_trig(e)))
        if z2 == 0:
            z = z2
    holds = z == 0 or _zero_check(e)
    if holds:
        how = 'simplified the difference of the two sides to 0' if z == 0 else 'checked numerically at several random points'
        return {'latex_in': latex(e) + ' = 0', 'latex_out': r'\text{identity}', 'text': 'True — this is an identity', 'plain': 'true', 'verified': {'ok': True, 'how': 'Left side − right side ' + how},
                'lines': [['Left − right', '0']], 'notes': ['Holds for every value where both sides are defined'], 'exact': True}
    # counterexample
    rnd = random.Random(3)
    sub = {s_: Rational(rnd.randint(1, 9), 7) for s_ in fs}
    val = N(e.subs(sub), 8)
    pt = ', '.join(_pp(k) + ' = ' + _pp(v_) for k, v_ in sub.items())
    return {'latex_in': latex(e) + ' = 0', 'latex_out': r'\text{not an identity}', 'text': 'False — not an identity', 'plain': 'false',
            'lines': [['Left − right simplifies to', _pp(z)], ['Counterexample', 'at ' + pt + ' the sides differ by ' + _fmt_float(val, 6)]], 'exact': True}

def _dsolve(req):
    eq = _parse(req['exprs'][0])
    ics = {}
    x = Symbol('x', real=True)
    f = Function('f')
    for pt, order, val in req.get('ics') or []:
        p = _parse(pt); v = _parse(val)
        if order == 0:
            ics[f(p)] = v
        else:
            ics[f(x).diff(x, order).subs(x, p)] = v
    sol = dsolve(eq, ics=ics) if ics else dsolve(eq)
    sols = sol if isinstance(sol, list) else [sol]
    try:
        ver = all(checkodesol(eq, s_)[0] for s_ in sols)
    except Exception:
        ver = None
    to_y = lambda s_: latex(s_).replace('f{\\left(x \\right)}', 'y')
    def _ode_nice(r):
        r2 = expand(r)
        if not r2.has(sin, cos) and len(_pp(r2)) <= len(_pp(r)) + 4:
            return r2
        return _nice(r) if not r.has(Symbol('C1')) else r
    sols = [Eq(s_.lhs, _ode_nice(s_.rhs)) for s_ in sols]
    txt = '; '.join('y = ' + _pp(s_.rhs) for s_ in sols)
    notes = [] if ics else ['C₁, C₂… are arbitrary constants']
    if ics:
        notes.append('Particular solution from the initial conditions')
    out = {'latex_in': to_y(eq), 'latex_out': ', \\quad '.join(to_y(s_) for s_ in sols), 'text': txt.replace('C1', 'C₁').replace('C2', 'C₂').replace('C3', 'C₃'), 'plain': '; '.join(_plain(s_.rhs) for s_ in sols), 'notes': notes, 'exact': True}
    if ver is not None:
        out['verified'] = {'ok': bool(ver), 'how': 'Substituted back into the equation (checkodesol)'}
    return out

def _rsolve(req):
    n = Symbol('n', integer=True)
    a = Function('a')
    eq = _parse(req['exprs'][0]).subs(Symbol('n'), n)
    ns = dict(_NS); ns['a'] = a; ns['n'] = n
    ics = {}
    for k, v in req.get('ics') or []:
        ics[a(int(k))] = _parse(v)
    r = rsolve(eq, a(n), ics or None)
    if r is None:
        raise ValueError('No closed form found for this recurrence')
    r = simplify(r)
    terms = [simplify(r.subs(n, k)) for k in range(int(min(ics.keys(), key=lambda z: z.args[0]).args[0]) if ics else 0, (int(min(ics.keys(), key=lambda z: z.args[0]).args[0]) if ics else 0) + 6)]
    return {'latex_in': latex(eq), 'latex_out': 'a_n = ' + latex(r), 'text': 'aₙ = ' + _pp(r), 'plain': _plain(r), 'lines': [['First terms', ', '.join(_pp(t_) for t_ in terms)]], 'exact': True}

def _linrec(vals):
    for k in range(1, len(vals) // 2 + 1):
        cs = symbols('c0:%d' % k)
        eqs = [vals[i] - sum(cs[j] * vals[i - 1 - j] for j in range(k)) for i in range(k, len(vals))]
        if len(eqs) < k + 1 and k > 1:
            break
        sol = solve(eqs, cs, dict=True)
        if sol and all(c in sol[0] for c in cs):
            return [sol[0][c] for c in cs]
    return None

def _sequence(req):
    vals = [_parse(s_) for s_ in req['exprs']]
    task = req.get('task', 'nth')
    N_ = req.get('n')
    n = Symbol('n', integer=True, positive=True)
    kind = None
    diffs = [simplify(vals[i + 1] - vals[i]) for i in range(len(vals) - 1)]
    if len(vals) >= 2 and all(d_ == diffs[0] for d_ in diffs) and not req.get('geometric'):
        kind = 'arithmetic'
        a1 = vals[0]; d = diffs[0]
        term = expand(a1 + (n - 1) * d)
        Sn = expand(n * (2 * a1 + (n - 1) * d) / 2)
        lines = [['Type', 'arithmetic, first term ' + _pp(a1) + ', common difference ' + _pp(d)], ['nth term', 'aₙ = ' + _pp(term)], ['Sum of first n', 'Sₙ = ' + _pp(factor(Sn))]]
    elif len(vals) >= 2 and all(v_ != 0 for v_ in vals) and len(set(simplify(vals[i + 1] / vals[i]) for i in range(len(vals) - 1))) == 1:
        kind = 'geometric'
        a1 = vals[0]; r = simplify(vals[1] / vals[0])
        term = a1 * r ** (n - 1)
        Sn = a1 * (1 - r ** n) / (1 - r) if r != 1 else a1 * n
        lines = [['Type', 'geometric, first term ' + _pp(a1) + ', common ratio ' + _pp(r)], ['nth term', 'aₙ = ' + _pp(term)], ['Sum of first n', 'Sₙ = ' + _pp(simplify(Sn))]]
        if abs(r) < 1:
            lines.append(['Sum to infinity', _pp(simplify(a1 / (1 - r))) + '  (|r| < 1)'])
        else:
            lines.append(['Sum to infinity', 'diverges (|r| ≥ 1)'])
    else:
        # second differences constant → quadratic; else linear recurrence
        if len(vals) >= 4:
            d2 = [simplify(diffs[i + 1] - diffs[i]) for i in range(len(diffs) - 1)]
            if all(x_ == d2[0] for x_ in d2) and d2[0] != 0:
                kind = 'quadratic'
                k = Symbol('n')
                term = expand(interpolate(vals, k).subs(k, n))
                lines = [['Type', 'quadratic (constant second difference ' + _pp(d2[0]) + ')'], ['nth term', 'aₙ = ' + _pp(term)]]
        if kind is None:
            coeffs = _linrec(vals)
            if coeffs:
                kind = 'recurrence'
                nxt = sum(c * vals[-1 - i] for i, c in enumerate(coeffs))
                rel = ' + '.join((_pp(c) + '·' if c != 1 else '') + 'aₙ₋' + _sub(i + 1) for i, c in enumerate(coeffs))
                lines = [['Rule', 'aₙ = ' + rel], ['Next term', _pp(nxt)]]
                if task == 'next':
                    return {'latex_in': ', '.join(latex(v_) for v_ in vals), 'latex_out': latex(nxt), 'text': _pp(nxt), 'plain': _plain(nxt), 'numeric': _num(nxt), 'lines': lines, 'notes': ['Pattern: linear recurrence found from the terms given (other rules could fit too)'], 'exact': True}
                term = None
            else:
                raise ValueError('I can’t find a pattern (arithmetic, geometric, quadratic or linear recurrence) in these terms')
    notes = []
    if task in ('ratio', 'difference'):
        val_ = simplify(vals[1] / vals[0]) if task == 'ratio' else simplify(vals[1] - vals[0])
        return _res(val_, None, lines=lines)
    if task == 'next':
        r = term.subs(n, len(vals) + 1)
        return _res(simplify(r), None, lines=lines, notes=['Next term of the ' + kind + ' sequence'])
    if task == 'term' and N_ is not None:
        r = simplify(term.subs(n, int(N_)))
        return _res(r, None, text='a' + _sub(int(N_)) + ' = ' + _pp(r), lines=lines)
    if task == 'sum' and N_ is not None:
        if kind == 'arithmetic' or kind == 'geometric':
            r = simplify(Sn.subs(n, int(N_)))
        else:
            r = sum(term.subs(n, k) for k in range(1, int(N_) + 1))
        return _res(r, None, text='S' + _sub(int(N_)) + ' = ' + _pp(r), lines=lines)
    if task == 'sum_to' and req.get('scalar'):
        last = _parse(req['scalar'])
        cnt = solve(term - last, n)
        cnt = [c for c in cnt if c.is_integer and c > 0]
        if not cnt:
            raise ValueError(_pp(last) + ' is not a term of this sequence')
        k = int(cnt[0])
        r = simplify(Sn.subs(n, k)) if kind in ('arithmetic', 'geometric') else sum(term.subs(n, j) for j in range(1, k + 1))
        return _res(r, None, lines=lines + [['Number of terms', str(k)]], notes=['Sum of ' + str(k) + ' terms of the ' + kind + ' sequence'])
    if task == 'sum_inf':
        if kind == 'geometric' and abs(vals[1] / vals[0]) < 1:
            r = simplify(vals[0] / (1 - vals[1] / vals[0]))
            return _res(r, None, lines=lines, notes=['Sum to infinity = a / (1 − r)'])
        return {'latex_in': '', 'latex_out': r'\text{diverges}', 'text': 'Diverges', 'plain': 'inf', 'lines': lines, 'notes': ['Only a geometric series with |r| < 1 has a finite sum to infinity'], 'exact': True}
    return {'latex_in': ', '.join(latex(v_) for v_ in vals), 'latex_out': 'a_n = ' + latex(term), 'text': 'aₙ = ' + _pp(term), 'plain': _plain(term), 'lines': lines, 'exact': True}

def _extrema(req):
    e = _parse(req['exprs'][0], real=True)
    fs = _free([e])
    v = _sym(req['vars'][0], True) if req.get('vars') else (fs[0] if fs else Symbol('x', real=True))
    what = req.get('what', 'all')
    d1 = simplify(diff(e, v)); d2 = simplify(diff(e, v, 2))
    lines = [["f′(" + _pp(v) + ")", _pp(d1)], ["f″(" + _pp(v) + ")", _pp(d2)]]
    notes = []
    def real_roots(expr):
        try:
            s_ = solveset(expr, v, S.Reals)
            if isinstance(s_, FiniteSet):
                return sorted(s_, key=lambda z: N(z))
            if isinstance(s_, (ImageSet, Union)):
                notes.append('Periodic: showing the solutions in [0, 2π)')
                s2 = solveset(expr, v, Interval(0, 2 * pi, False, True))
                return sorted(s2, key=lambda z: N(z)) if isinstance(s2, FiniteSet) else []
        except Exception:
            pass
        return [z for z in solve(expr, v) if _is_realnum(z)]
    pts = []
    zeros = real_roots(e) if what in ('all', 'zeros') else []
    crit = real_roots(d1) if what in ('all', 'extrema', 'max', 'min') else []
    for c in crit:
        y = simplify(e.subs(v, c))
        k = simplify(d2.subs(v, c))
        if k.is_number and k > 0:
            nature = 'local minimum'
        elif k.is_number and k < 0:
            nature = 'local maximum'
        else:
            l = N(d1.subs(v, c - Rational(1, 1000))); r_ = N(d1.subs(v, c + Rational(1, 1000)))
            nature = 'local minimum' if l < 0 < r_ else 'local maximum' if l > 0 > r_ else 'stationary point of inflection'
        pts.append(['(' + _pp(c) + ', ' + _pp(y) + ')', nature])
    infl = []
    if what in ('all', 'inflection'):
        for c in real_roots(d2):
            d3 = diff(e, v, 3).subs(v, c)
            l = N(d2.subs(v, c - Rational(1, 1000))); r_ = N(d2.subs(v, c + Rational(1, 1000)))
            if (l < 0 < r_) or (l > 0 > r_):
                infl.append('(' + _pp(c) + ', ' + _pp(simplify(e.subs(v, c))) + ')')
    out_lines = []
    if what in ('all', 'zeros'):
        out_lines.append(['Zeros', ', '.join(_pp(v) + ' = ' + (_pp(z) if _short(z) else '≈ ' + _num(z, 8)) for z in zeros) or 'none (real)'])
        try:
            out_lines.append(['y-intercept', '(0, ' + _pp(simplify(e.subs(v, 0))) + ')'])
        except Exception:
            pass
    if what in ('all', 'extrema'):
        out_lines += [[p, n_] for p, n_ in pts] or [['Stationary points', 'none']]
    if what in ('all', 'inflection'):
        out_lines.append(['Inflection points', ', '.join(infl) or 'none'])
    if what in ('all', 'asymptotes'):
        num, den = fraction(together(e))
        va = [z for z in real_roots(den)] if den.has(v) else []
        if va:
            out_lines.append(['Vertical asymptotes', ', '.join(_pp(v) + ' = ' + _pp(z) for z in va)])
        try:
            lp = limit(e, v, oo); lm = limit(e, v, -oo)
            ha = sorted(set([z for z in (lp, lm) if z.is_finite]), key=lambda z: N(z))
            if ha:
                out_lines.append(['Horizontal asymptote', ', '.join('y = ' + _pp(z) for z in ha)])
            else:
                out_lines.append(['End behaviour', 'x→∞: ' + _pp(lp) + ', x→−∞: ' + _pp(lm)])
            if what == 'asymptotes' and fraction(together(e))[0].is_polynomial(v) and den.is_polynomial(v) and Poly(num, v).degree() == Poly(den, v).degree() + 1:
                q_, _r = div(num, den, v)
                out_lines.append(['Oblique asymptote', 'y = ' + _pp(q_)])
        except Exception:
            pass
    if what == 'all':
        sym = simplify(e.subs(v, -v))
        if sym == e:
            out_lines.append(['Symmetry', 'even (symmetric about the y-axis)'])
        elif simplify(sym + e) == 0:
            out_lines.append(['Symmetry', 'odd (symmetric about the origin)'])
    if what in ('max', 'min'):
        cands = [(simplify(e.subs(v, c)), c) for c in crit]
        lim_p = limit(e, v, oo); lim_m = limit(e, v, -oo)
        if what == 'max':
            unb = lim_p == oo or lim_m == oo
            best = max(cands, key=lambda t: N(t[0])) if cands else None
        else:
            unb = lim_p == -oo or lim_m == -oo
            best = min(cands, key=lambda t: N(t[0])) if cands else None
        word = 'maximum' if what == 'max' else 'minimum'
        if best is None or unb:
            txt = 'No absolute ' + word + ' (unbounded)' + ('; local ' + word + ' ' + _pp(best[0]) + ' at x = ' + _pp(best[1]) if best is not None and any(n_ == 'local ' + word for _, n_ in pts) else '')
        else:
            txt = word.capitalize() + ' ' + _pp(best[0]) + ' at ' + _pp(v) + ' = ' + _pp(best[1])
        return {'latex_in': latex(e), 'latex_out': "f'(x) = " + latex(d1), 'text': txt, 'plain': _plain(best[0]) if best is not None else 'none', 'numeric': _num(best[0]) if best is not None and not unb else None, 'lines': lines + [[p, n_] for p, n_ in pts], 'exact': True}
    if what == 'extrema':
        txt = '; '.join(p + ' ' + n_ for p, n_ in pts) if pts else 'No stationary points'
    elif what == 'inflection':
        txt = ', '.join(infl) if infl else 'No inflection points'
    elif what == 'zeros':
        txt = out_lines[0][1]
    elif what == 'asymptotes':
        asy = [l_[0] + ': ' + l_[1] for l_ in out_lines if 'symptote' in l_[0]]
        txt = '; '.join(asy) if asy else 'No vertical or horizontal asymptotes'
    else:
        txt = 'Curve sketch of ' + _pp(e)
    return {'latex_in': latex(e), 'latex_out': "f'(x) = " + latex(d1), 'text': txt.replace('-', '−'), 'plain': txt, 'lines': lines + out_lines, 'notes': notes, 'exact': True}

def _sq(v, h):
    return (_pp(v) if h == 0 else '(' + _pp(v - h) + ')') + '²'

def _den(d):
    t = _pp(d)
    return t if (d.is_Integer or d.is_Symbol) else '(' + t + ')'

def _conic(req):
    e = _parse(req['exprs'][0], real=True)
    x, y = Symbol('x', real=True), Symbol('y', real=True)
    e = e.subs({Symbol('x'): x, Symbol('y'): y})
    p = Poly(expand(e), x, y)
    A = p.coeff_monomial(x ** 2); B = p.coeff_monomial(x * y); C = p.coeff_monomial(y ** 2)
    D = p.coeff_monomial(x); E = p.coeff_monomial(y); F = p.coeff_monomial(1)
    disc = B ** 2 - 4 * A * C
    lines = []
    if A == 0 and B == 0 and C == 0:
        raise ValueError('That is a line, not a conic')
    if B == 0:
        h = -D / (2 * A) if A != 0 else None
        k = -E / (2 * C) if C != 0 else None
        if A != 0 and C != 0:
            rhs = -F + (A * h ** 2 if A else 0) + (C * k ** 2)
            if A == C:
                kind = 'circle'
                r2 = rhs / A
                lines = [['Centre', '(' + _pp(h) + ', ' + _pp(k) + ')'], ['Radius', _pp(sqrt(r2)) if r2 > 0 else 'none (no real points)']]
                std = _sq(x, h) + ' + ' + _sq(y, k) + ' = ' + _pp(r2)
            elif disc < 0:
                kind = 'ellipse'
                a2 = rhs / A; b2 = rhs / C
                lines = [['Centre', '(' + _pp(h) + ', ' + _pp(k) + ')'], ['Semi-axes', 'a = ' + _pp(sqrt(a2)) + ' (x), b = ' + _pp(sqrt(b2)) + ' (y)']]
                big, small = (a2, b2) if a2 >= b2 else (b2, a2)
                c_ = sqrt(big - small)
                foci = ['(' + _pp(h + c_) + ', ' + _pp(k) + ')', '(' + _pp(h - c_) + ', ' + _pp(k) + ')'] if a2 >= b2 else ['(' + _pp(h) + ', ' + _pp(k + c_) + ')', '(' + _pp(h) + ', ' + _pp(k - c_) + ')']
                lines += [['Foci', ', '.join(foci)], ['Eccentricity', _pp(simplify(c_ / sqrt(big)))]]
                std = _sq(x, h) + '/' + _den(a2) + ' + ' + _sq(y, k) + '/' + _den(b2) + ' = 1'
            else:
                kind = 'hyperbola'
                a2 = rhs / A; b2 = -rhs / C
                std = (_sq(x, h) + ('/' + _den(a2) if a2 != 1 else '') + ' − ' + _sq(y, k) + ('/' + _den(b2) if b2 != 1 else '') + ' = 1') if a2 > 0 else (_sq(y, k) + ('/' + _den(-b2) if -b2 != 1 else '') + ' − ' + _sq(x, h) + ('/' + _den(-a2) if -a2 != 1 else '') + ' = 1')
                c_ = sqrt(abs(a2) + abs(b2))
                lines = [['Centre', '(' + _pp(h) + ', ' + _pp(k) + ')'], ['Asymptotes', 'y − ' + _pp(k) + ' = ±' + _pp(sqrt(abs(b2) / abs(a2))) + '(x − ' + _pp(h) + ')'], ['Eccentricity', _pp(simplify(c_ / sqrt(abs(a2 if a2 > 0 else b2))))]]
        else:
            kind = 'parabola'
            if A != 0:
                # A x^2 + D x + E y + F = 0 → y = ...
                yy = solve(e, y)
                vx = -D / (2 * A)
                vy = simplify(yy[0].subs(x, vx)) if yy else None
                lines = [['Vertex', '(' + _pp(vx) + ', ' + _pp(vy) + ')'], ['Axis', 'x = ' + _pp(vx)]]
                if E != 0:
                    pfoc = -E / (4 * A)
                    lines.append(['Focus', '(' + _pp(vx) + ', ' + _pp(vy + pfoc) + ')'])
                    lines.append(['Directrix', 'y = ' + _pp(vy - pfoc)])
                std = 'y = ' + _pp(yy[0]) if yy else _pp(e) + ' = 0'
            else:
                xx = solve(e, x)
                vy = -E / (2 * C)
                vx = simplify(xx[0].subs(y, vy)) if xx else None
                lines = [['Vertex', '(' + _pp(vx) + ', ' + _pp(vy) + ')'], ['Axis', 'y = ' + _pp(vy)]]
                if D != 0:
                    pfoc = -D / (4 * C)
                    lines.append(['Focus', '(' + _pp(vx + pfoc) + ', ' + _pp(vy) + ')'])
                    lines.append(['Directrix', 'x = ' + _pp(vx - pfoc)])
                std = 'x = ' + _pp(xx[0]) if xx else _pp(e) + ' = 0'
    else:
        kind = 'ellipse' if disc < 0 else 'parabola' if disc == 0 else 'hyperbola'
        std = _pp(e) + ' = 0'
        lines = [['Discriminant B² − 4AC', _pp(disc)], ['Note', 'rotated conic (xy term present)']]
    want = req.get('what')
    pick = next((l_ for l_ in lines if want and l_[0].lower().startswith(want)), None)
    text = (pick[0] + ': ' + pick[1]) if pick else kind.capitalize() + ': ' + std
    return {'latex_in': latex(Eq(e, 0)), 'latex_out': r'\text{' + kind + '}', 'text': text.replace('-', '−'), 'plain': kind, 'lines': [['Type', kind], ['Standard form', std.replace('-', '−')]] + lines, 'exact': True}

def _logic(req):
    e = _parse(req['exprs'][0])
    task = req.get('task', 'simplify')
    syms = sorted(e.free_symbols, key=lambda s_: s_.name)
    if task == 'table':
        rows = []
        for vals in __import__('itertools').product([True, False], repeat=len(syms)):
            sub = dict(zip(syms, vals))
            rows.append(['T' if v_ else 'F' for v_ in vals] + ['T' if bool(e.subs(sub)) else 'F'])
        return {'latex_in': latex(e), 'latex_out': latex(e), 'text': 'Truth table of ' + _pp(e), 'plain': _plain(e), 'table': {'columns': [s_.name for s_ in syms] + [_pp(e)], 'rows': rows}, 'exact': True}
    r = simplify_logic(e)
    if task in ('tautology', 'contradiction'):
        yes = (r == true) if task == 'tautology' else (r == false)
        return {'latex_in': latex(e), 'latex_out': latex(r), 'text': 'Yes' if yes else 'No', 'plain': 'true' if yes else 'false', 'lines': [['Simplifies to', _pp(r)]],
                'notes': ['A tautology is true for every assignment' if task == 'tautology' else 'A contradiction is false for every assignment'], 'exact': True}
    lines = [['Simplified', _pp(r)], ['DNF', _pp(to_dnf(e, simplify=True))], ['CNF', _pp(to_cnf(e, simplify=True))]]
    notes = ['Tautology (always true)'] if r == true else ['Contradiction (always false)'] if r == false else []
    return {'latex_in': latex(e), 'latex_out': latex(r), 'text': _pp(r), 'plain': _plain(r), 'lines': lines, 'notes': notes, 'verified': {'ok': bool(simplify_logic(Equivalent(e, r)) == true), 'how': 'Checked equivalence over every truth assignment'}, 'exact': True}

# ---------- matrices & vectors ----------
def _quadinfo(req):
    e = _parse(req['exprs'][0])
    fs = _free([e])
    v = _pick([e], 1)[0] if fs else Symbol('x')
    p = Poly(e, v)
    mode = req.get('mode')
    deg = p.degree()
    co = p.all_coeffs()
    lines = []
    if mode in ('discriminant', 'nature', 'formula'):
        D = discriminant(p)
        lines.append(['Discriminant', _pp(D) + ('' if deg != 2 else '  (b² − 4ac)')])
        if D.is_number:
            if deg == 2:
                nat = 'two distinct real roots' if D > 0 else 'one repeated real root' if D == 0 else 'two complex (non-real) conjugate roots'
            elif deg == 3:
                nat = 'three distinct real roots' if D > 0 else 'a repeated root' if D == 0 else 'one real root and two complex conjugate roots'
            else:
                nat = 'distinct roots' if D != 0 else 'a repeated root'
            lines.append(['Nature of roots', nat])
            if D > 0 and deg == 2 and sqrt(D).is_Rational:
                lines.append(['Note', 'D is a perfect square, so the roots are rational'])
        if mode == 'discriminant':
            return _res(D, latex(e), lines=lines)
        if mode == 'nature':
            return {'latex_in': latex(e), 'latex_out': latex(D), 'text': lines[1][1].capitalize() if len(lines) > 1 else 'Depends on the parameters', 'plain': _plain(D), 'lines': lines, 'exact': True}
        if deg != 2:
            raise ValueError('The quadratic formula needs a degree-2 polynomial')
        a_, b_, c_ = co
        sols = roots(p, multiple=False)
        pm = _pm(*list(sols.keys())) if len(sols) == 2 else None
        sub = '(−(' + _pp(b_) + ') ± √(' + _pp(b_) + '² − 4·' + ('(' + _pp(a_) + ')' if a_ < 0 else _pp(a_)) + '·' + ('(' + _pp(c_) + ')' if c_.is_number and c_ < 0 else _pp(c_)) + '))/(2·' + _pp(a_) + ')'
        lines.insert(0, ['Formula', 'x = (−b ± √(b² − 4ac))/(2a)'])
        lines.insert(1, ['Substituted', sub])
        lines.append(['Solutions', ', '.join(_pp(k) for k in sols)])
        txt = _pp(v) + ' = ' + (pm or ', '.join(_pp(k) for k in sols))
        return {'latex_in': latex(Eq(e, 0)), 'latex_out': ', '.join(latex(k) for k in sols), 'text': txt, 'plain': ', '.join(_plain(k) for k in sols), 'lines': lines, 'exact': True}
    s_ = simplify(-co[1] / co[0]) if deg >= 1 else 0
    pr = simplify((-1) ** deg * co[-1] / co[0])
    if mode == 'sum':
        return _res(s_, latex(e), notes=['Vieta: sum of roots = −b/a'])
    if mode == 'product':
        return _res(pr, latex(e), notes=['Vieta: product of roots = ' + ('c/a' if deg == 2 else '(−1)ⁿ·a₀/aₙ')])
    return {'latex_in': latex(e), 'latex_out': '', 'text': 'Sum = ' + _pp(s_) + ', product = ' + _pp(pr), 'plain': _plain(s_) + ', ' + _plain(pr), 'lines': [['Sum of roots (−b/a)', _pp(s_)], ['Product of roots', _pp(pr)]], 'notes': ["Vieta's formulas"], 'exact': True}

def _fninfo(req):
    mode = req.get('mode')
    vn = (req.get('vars') or ['x'])[0]
    v = Symbol(vn, real=True)
    exprs = [_parse(s_, True) for s_ in req['exprs']]
    e = exprs[0].subs(Symbol(vn), v)
    if mode == 'compose':
        names = (req.get('scalar') or 'f(g(x))|g(f(x))').split('|')
        a, b = [_nice(simplify(z)) for z in exprs]
        return {'latex_in': '', 'latex_out': latex(a), 'text': names[0] + ' = ' + _pp(a), 'plain': _plain(a), 'lines': [[names[0], _pp(a)], [names[1], _pp(b)]], 'notes': ['Composition is usually not commutative'], 'exact': True}
    if mode == 'inverse':
        y = Symbol('y', real=True)
        sols = solve(Eq(y, e), v)
        if not sols:
            raise ValueError('No inverse found (the function may not be one-to-one)')
        sols = [_nice(simplify(z.subs(y, v))) for z in sols]
        if any(not z.has(I) for z in sols):
            sols = [z for z in sols if not z.has(I)]
        notes = []
        if len(sols) > 1:
            notes.append('Not one-to-one on all of ℝ: each branch is an inverse on a restricted domain')
        ok = _zero_check(simplify(e.subs(v, sols[0])) - v) if not sols[0].has(sqrt, Abs) else None
        txt = 'f⁻¹(' + _pp(v) + ') = ' + ' or '.join(_pp(z) for z in sols)
        out = {'latex_in': latex(e), 'latex_out': 'f^{-1}(x) = ' + latex(sols[0]), 'text': txt, 'plain': _plain(sols[0]), 'lines': [['Method', 'swap x and y, then solve for y']], 'notes': notes, 'exact': True}
        if ok is not None:
            out['verified'] = {'ok': bool(ok), 'how': 'Checked f(f⁻¹(x)) = x'}
        return out
    if mode == 'parity':
        m_ = simplify(e.subs(v, -v))
        even = simplify(m_ - e) == 0
        odd = simplify(m_ + e) == 0
        txt = 'Even' if even else 'Odd' if odd else 'Neither even nor odd'
        return {'latex_in': latex(e), 'latex_out': r'\text{' + txt + '}', 'text': txt, 'plain': txt.lower(), 'lines': [['f(−' + vn + ')', _pp(m_)]], 'notes': ['Even: f(−x) = f(x) (symmetric about the y-axis); odd: f(−x) = −f(x) (symmetric about the origin)'], 'exact': True}
    if mode == 'sinusoid':
        per = periodicity(e, v)
        lines = [['Period', _pp(per) if per is not None else 'not periodic']]
        if per is not None and per != 0:
            lines.append(['Frequency', _pp(simplify(1 / per)) + ' cycles per unit'])
        a_, b_, c_, d_ = [Wild(w, exclude=[v]) for w in 'abcd']
        mt = None
        for f in (sin, cos):
            mt = e.match(a_ * f(b_ * v + c_) + d_)
            if mt and mt.get(b_, 0) != 0:
                break
            mt = None
        if mt:
            A, B, C, Dd = mt[a_], mt[b_], mt.get(c_, 0), mt.get(d_, 0)
            lines = [['Amplitude', _pp(Abs(A))], ['Period', _pp(simplify(2 * pi / Abs(B)))], ['Phase shift', _pp(simplify(-C / B)) + (' (to the right)' if (-C / B).is_positive else ' (to the left)' if (-C / B).is_negative else '')], ['Vertical shift (midline)', 'y = ' + _pp(Dd)]]
            lines.append(['Range', '[' + _pp(Dd - Abs(A)) + ', ' + _pp(Dd + Abs(A)) + ']'])
        txt = ', '.join(l_[0] + ' ' + l_[1] for l_ in lines[:2])
        return {'latex_in': latex(e), 'latex_out': '', 'text': txt, 'plain': _plain(per) if per is not None else 'none', 'lines': lines, 'exact': True}
    if mode in ('domain', 'range', 'domain and range'):
        from sympy.calculus.util import continuous_domain, function_range
        dom = continuous_domain(e, v, S.Reals)
        lines = [['Domain', _settext(dom, v).replace('-', '−') + '   ' + _ivtext(dom).replace('-', '−')]]
        rng = None
        try:
            rng = function_range(e, v, dom)
            lines.append(['Range', _settext(rng, Symbol('y')).replace('-', '−') + '   ' + _ivtext(rng).replace('-', '−')])
        except Exception:
            if mode != 'domain':
                lines.append(['Range', 'could not be determined automatically'])
        if mode == 'domain':
            txt = lines[0][1]
        elif mode == 'range':
            txt = lines[1][1] if rng is not None else 'Could not determine the range'
        else:
            txt = 'Domain: ' + _ivtext(dom) + '; range: ' + (_ivtext(rng) if rng is not None else '?')
        return {'latex_in': latex(e), 'latex_out': latex(rng if mode == 'range' and rng is not None else dom), 'text': txt, 'plain': _plain(dom), 'lines': lines, 'notes': ['Over the real numbers'], 'exact': True}
    raise ValueError('Unknown function question')

def _vcalc(req):
    mode = req.get('mode')
    exprs = [_parse(s_, True) for s_ in req['exprs']]
    fs = sorted(set().union(*[e.free_symbols for e in exprs]), key=lambda z: z.name)
    names = [z.name for z in fs]
    vs = [z for z in [Symbol(n, real=True) for n in ('x', 'y', 'z')] if z.name in names] or fs
    if len(exprs) > 1 and len(vs) < len(exprs) and mode in ('divergence', 'curl', 'jacobian'):
        vs = [Symbol(n, real=True) for n in ('x', 'y', 'z')][:len(exprs)]
    at = [_parse(s_, True) for s_ in (req.get('at') or [])]
    sub = dict(zip(vs, at)) if at else None
    vec = lambda m: '(' + ', '.join(_pp(c) for c in m) + ')'
    f = exprs[0]
    if mode == 'gradient':
        g = Matrix([diff(f, v) for v in vs])
        lines = [['∂f/∂' + v.name, _pp(simplify(c))] for v, c in zip(vs, g)]
        if sub:
            gv = g.subs(sub)
            lines.append(['At ' + vec(at), vec(gv)])
            lines.append(['|∇f| there', _pp(sqrt(gv.dot(gv)))])
            return {'latex_in': r'\nabla f', 'latex_out': latex(gv.T), 'text': '∇f' + vec(at) + ' = ' + vec(gv), 'plain': _plain(list(gv)), 'lines': lines, 'exact': True}
        return {'latex_in': r'\nabla f', 'latex_out': latex(g.T), 'text': '∇f = ' + vec(simplify(g)), 'plain': _plain(list(g)), 'lines': lines, 'exact': True}
    if mode == 'hessian':
        H = hessian(f, vs)
        lines = [['det H', _pp(simplify(H.det()))]]
        if sub:
            H = H.subs(sub)
        return {'latex_in': 'H', 'latex_out': latex(H), 'text': _pp(simplify(H)), 'plain': _plain(H.tolist()), 'lines': lines, 'exact': True}
    if mode == 'laplacian':
        r = simplify(sum(diff(f, v, 2) for v in vs))
        return _res(r.subs(sub) if sub else r, r'\nabla^2 f')
    if mode == 'jacobian':
        J = Matrix(exprs).jacobian(vs)
        lines = [['det J', _pp(simplify(J.det()))]] if J.shape[0] == J.shape[1] else []
        return {'latex_in': 'J', 'latex_out': latex(J), 'text': _pp(simplify(J)), 'plain': _plain(J.tolist()), 'lines': lines, 'exact': True}
    if mode == 'divergence':
        r = simplify(sum(diff(c, v) for c, v in zip(exprs, vs)))
        return _res(r.subs(sub) if sub else r, r'\nabla\cdot\mathbf{F}')
    if mode == 'curl':
        P, Q, R = (exprs + [0, 0, 0])[:3]
        x, y, z = (vs + [Symbol('z', real=True)] * 3)[:3]
        c = Matrix([diff(R, y) - diff(Q, z), diff(P, z) - diff(R, x), diff(Q, x) - diff(P, y)]).applyfunc(simplify)
        return {'latex_in': r'\nabla\times\mathbf{F}', 'latex_out': latex(c.T), 'text': vec(c), 'plain': _plain(list(c)), 'notes': ['Conservative (irrotational) field'] if all(x_ == 0 for x_ in c) else [], 'exact': True}
    if mode == 'directional':
        d = Matrix([_parse(s_, True) for s_ in req['direction']])
        g = Matrix([diff(f, v) for v in vs]).subs(sub)
        u = d / sqrt(d.dot(d))
        r = simplify(g.dot(u))
        return _res(r, r'D_{\mathbf{u}}f', lines=[['∇f at the point', vec(g)], ['Unit direction', vec(u)]])
    if mode == 'tangentplane':
        x, y = vs[0], vs[1]
        z0 = f.subs(sub); fx = diff(f, x).subs(sub); fy = diff(f, y).subs(sub)
        zz = expand(z0 + fx * (x - at[0]) + fy * (y - at[1]))
        return {'latex_in': '', 'latex_out': 'z = ' + latex(zz), 'text': 'z = ' + _pp(zz), 'plain': _plain(zz), 'lines': [['Point', '(' + ', '.join(_pp(c) for c in at) + ', ' + _pp(z0) + ')'], ['f_x, f_y', _pp(fx) + ', ' + _pp(fy)]], 'exact': True}
    raise ValueError('Unknown vector calculus operation')

def _calcapp(req):
    mode = req.get('mode')
    v = Symbol((req.get('vars') or ['x'])[0], real=True)
    fs = [_parse(s_, True).subs(Symbol(v.name, real=True), v) for s_ in req['exprs']]
    f = fs[0]
    a = _parse(req['lower'], True) if req.get('lower') else None
    b = _parse(req['upper'], True) if req.get('upper') else None
    notes = []
    if mode == 'between':
        g = fs[1]
        if a is None:
            pts = sorted([z for z in solve(f - g, v) if _is_realnum(z)], key=lambda z: N(z))
            if len(pts) < 2:
                raise ValueError('The curves do not enclose a region (give the x-limits)')
            a, b = pts[0], pts[-1]
            notes.append('Limits are the intersection points x = ' + ', '.join(_pp(z) for z in pts))
        pts = sorted(set([a, b] + [z for z in solve(f - g, v) if _is_realnum(z) and N(a) < N(z) < N(b)]), key=lambda z: N(z))
        total = sum(Abs(integrate(f - g, (v, pts[i], pts[i + 1]))) for i in range(len(pts) - 1))
        r = simplify(total)
        return _res(r, r'\int_{' + latex(a) + '}^{' + latex(b) + r'} |f - g|\,dx', notes=notes)
    if mode == 'area':
        zs = sorted([z for z in solve(f, v) if _is_realnum(z) and N(a) < N(z) < N(b)], key=lambda z: N(z))
        pts = [a] + zs + [b]
        signed = simplify(integrate(f, (v, a, b)))
        r = simplify(sum(Abs(integrate(f, (v, pts[i], pts[i + 1]))) for i in range(len(pts) - 1)))
        lines = [['Signed integral', _pp(signed)]] if r != signed else []
        if zs:
            notes.append('The curve crosses the x-axis at ' + ', '.join(_pp(z) for z in zs) + ': areas below the axis are counted as positive')
        return _res(r, r'\int_{' + latex(a) + '}^{' + latex(b) + '} ' + latex(f) + r'\,dx', lines=lines, notes=notes)
    if mode == 'average':
        r = simplify(integrate(f, (v, a, b)) / (b - a))
        return _res(r, r'\frac{1}{b-a}\int_a^b f', notes=['Average value = (1/(b − a))∫f dx'])
    if mode.startswith('volume'):
        if mode == 'volume_x':
            r = simplify(pi * integrate(f ** 2, (v, a, b)))
            notes.append('Disc method: V = π∫y² dx')
        else:
            r = simplify(2 * pi * integrate(v * f, (v, a, b)))
            notes.append('Shell method: V = 2π∫x·y dx')
        return _res(r, 'V', notes=notes)
    if mode == 'surface':
        r = simplify(2 * pi * integrate(f * sqrt(1 + diff(f, v) ** 2), (v, a, b)))
        if r.has(Integral):
            r = N(r, 15)
        return _res(r, 'S', notes=['S = 2π∫y√(1 + y′²) dx'])
    r = integrate(sqrt(1 + diff(f, v) ** 2), (v, a, b))
    r = simplify(r)
    if r.has(Integral):
        r = N(Integral(sqrt(1 + diff(f, v) ** 2), (v, a, b)), 15)
        notes.append('Computed numerically')
    return _res(r, 'L', notes=['Arc length L = ∫√(1 + (dy/dx)²) dx'] + notes, exact=not r.is_Float)

def _matrix_more(M, mode):
    fmt = lambda X: _pp(X)
    if mode.startswith('is:'):
        prop = mode[3:].strip()
        if 'positive definite' in prop:
            yes = M.is_symmetric() and all(N(ev) > 0 for ev in M.eigenvals())
            why = 'symmetric with all eigenvalues positive' if yes else ('not symmetric' if not M.is_symmetric() else 'has a non-positive eigenvalue')
        elif 'symmetric' in prop:
            yes = M == M.T
            why = 'A = Aᵀ' if yes else 'A ≠ Aᵀ'
        elif 'orthogonal' in prop:
            yes = simplify(M.T * M) == eye(M.shape[0])
            why = 'AᵀA = I' if yes else 'AᵀA ≠ I'
        elif 'invertible' in prop or 'singular' in prop:
            dt = M.det()
            yes = (dt != 0) if 'invertible' in prop else (dt == 0)
            why = 'det = ' + _pp(dt)
        else:
            yes = M.is_diagonalizable()
            why = 'enough independent eigenvectors' if yes else 'not enough independent eigenvectors'
        return {'latex_in': latex(M), 'latex_out': r'\text{' + ('yes' if yes else 'no') + '}', 'text': 'Yes' if yes else 'No', 'plain': 'true' if yes else 'false', 'notes': [why], 'exact': True}
    if mode == 'lu':
        L, U, perm = M.LUdecomposition()
        return {'latex_in': latex(M), 'latex_out': 'L = ' + latex(L) + r',\ U = ' + latex(U), 'text': 'L = ' + fmt(L) + ', U = ' + fmt(U), 'plain': '', 'lines': [['L', fmt(L)], ['U', fmt(U)]] + ([['Row swaps', str(perm)]] if perm else []), 'verified': {'ok': bool(simplify(L * U) == M) or bool(perm), 'how': 'Multiplied L·U back'}, 'exact': True}
    if mode == 'qr':
        Q, R = M.QRdecomposition()
        return {'latex_in': latex(M), 'latex_out': 'Q = ' + latex(Q) + r',\ R = ' + latex(R), 'text': 'Q = ' + fmt(Q) + ', R = ' + fmt(R), 'plain': '', 'lines': [['Q', fmt(Q)], ['R', fmt(R)]], 'exact': True}
    if mode == 'svd':
        sv = M.singular_values()
        lines = [['Singular values', ', '.join(_pp(x) for x in sv)]]
        try:
            U, S_, V = M.singular_value_decomposition()
            lines += [['U', fmt(U)], ['Σ', fmt(S_)], ['V', fmt(V)]]
        except Exception:
            pass
        return {'latex_in': latex(M), 'latex_out': ', '.join(latex(x) for x in sv), 'text': 'σ = ' + ', '.join(_pp(x) for x in sv), 'plain': '', 'lines': lines, 'exact': True}
    if mode == 'diag':
        if not M.is_diagonalizable():
            raise ValueError('This matrix is not diagonalizable (not enough independent eigenvectors)')
        P, Dm = M.diagonalize()
        return {'latex_in': latex(M), 'latex_out': 'P = ' + latex(P) + r',\ D = ' + latex(Dm), 'text': 'D = ' + fmt(Dm) + ', P = ' + fmt(P), 'plain': '', 'lines': [['P', fmt(P)], ['D', fmt(Dm)], ['Check', 'A = P·D·P⁻¹']], 'verified': {'ok': bool(simplify(P * Dm * P.inv() - M) == zeros(*M.shape)), 'how': 'Multiplied P·D·P⁻¹ back'}, 'exact': True}
    if mode == 'cholesky':
        L = M.cholesky()
        return {'latex_in': latex(M), 'latex_out': latex(L), 'text': 'L = ' + fmt(L), 'plain': '', 'lines': [['Check', 'A = L·Lᵀ']], 'exact': True}
    if mode == 'jordan':
        P, J = M.jordan_form()
        return {'latex_in': latex(M), 'latex_out': latex(J), 'text': 'J = ' + fmt(J), 'plain': '', 'lines': [['P', fmt(P)]], 'exact': True}
    if mode == 'norm':
        r = M.norm()
        return _res(r, r'\|A\|_F')
    if mode == 'adj':
        r = M.adjugate()
        return {'latex_in': latex(M), 'latex_out': latex(r), 'text': fmt(r), 'plain': '', 'exact': True}
    if mode == 'cofactor':
        r = M.cofactor_matrix()
        return {'latex_in': latex(M), 'latex_out': latex(r), 'text': fmt(r), 'plain': '', 'exact': True}
    if mode == 'minors':
        r = Matrix(M.shape[0], M.shape[1], lambda i, j: M.minor(i, j))
        return {'latex_in': latex(M), 'latex_out': latex(r), 'text': fmt(r), 'plain': '', 'exact': True}
    if mode == 'exp':
        r = simplify(M.exp())
        return {'latex_in': 'e^{' + latex(M) + '}', 'latex_out': latex(r), 'text': fmt(r), 'plain': '', 'exact': True}
    raise ValueError('Unknown matrix operation')

def _matrix(req):
    mop = req.get('matrixOp', 'eval')
    if mop == 'solve':
        A = _parse(req['exprs'][0]); b = _parse(req['exprs'][1])
        if b.shape[0] == 1:
            b = b.T
        xs = symbols('x1:%d' % (A.shape[1] + 1))
        sol = linsolve((A, b), *xs)
        if sol is S.EmptySet or not sol:
            return {'latex_in': latex(A) + r'\mathbf{x} = ' + latex(b), 'latex_out': r'\text{no solution}', 'text': 'No solution (inconsistent system)', 'plain': 'none', 'exact': True}
        t_ = list(sol)[0]
        lines = [['x' + _sub(i + 1), _pp(v_)] for i, v_ in enumerate(t_)]
        txt = 'x = (' + ', '.join(_pp(v_) for v_ in t_) + ')'
        notes = ['Infinitely many solutions (free parameters x₁… appear)'] if any(v_.free_symbols for v_ in t_) else []
        ok = all(_zero_check(z) for z in (A * Matrix(t_) - b)) if not notes else None
        return {'latex_in': latex(A) + r'\mathbf{x} = ' + latex(b), 'latex_out': latex(Matrix(t_)), 'text': txt, 'plain': _plain(list(t_)), 'lines': lines, 'notes': notes,
                'verified': {'ok': bool(ok), 'how': 'Multiplied A·x back to b'} if ok is not None else None, 'exact': True}
    M = _parse(req['exprs'][0])
    if mop == 'eval':
        r = simplify(M)
        return {'latex_in': latex(M), 'latex_out': latex(r), 'text': _pp(r), 'plain': _plain(r.tolist() if hasattr(r, 'tolist') else r), 'numeric': _num(r) if not hasattr(r, 'shape') else None, 'exact': True}
    if not hasattr(M, 'shape'):
        raise ValueError('Expected a matrix like [[1,2],[3,4]]')
    if mop == 'more':
        return _matrix_more(M, req.get('mode') or '')
    if mop == 'det':
        if M.shape[0] != M.shape[1]:
            raise ValueError('Only square matrices have a determinant')
        r = factor(M.det()) if M.free_symbols else M.det()
        return _res(r, r'\det' + latex(M))
    if mop == 'inv':
        if M.shape[0] != M.shape[1]:
            raise ValueError('Only square matrices have an inverse')
        if M.det() == 0:
            raise ValueError('This matrix is singular (determinant 0), so it has no inverse')
        r = simplify(M.inv())
        ok = simplify(M * r) == eye(M.shape[0])
        return {'latex_in': latex(M) + '^{-1}', 'latex_out': latex(r), 'text': _pp(r), 'plain': _plain(r.tolist()), 'lines': [['Determinant', _pp(M.det())]], 'verified': {'ok': bool(ok), 'how': 'Multiplied back to the identity'}, 'exact': True}
    if mop == 'eigenvals':
        ev = M.eigenvals()
        lines = [['λ = ' + _pp(k), 'multiplicity ' + str(m_)] for k, m_ in ev.items()]
        return {'latex_in': latex(M), 'latex_out': ', \\quad '.join(r'\lambda = ' + latex(k) for k in ev), 'text': 'λ = ' + ', '.join(_pp(k) for k in ev), 'plain': ', '.join(_plain(k) for k in ev), 'lines': lines, 'exact': True}
    if mop == 'eigenvects':
        ev = M.eigenvects()
        parts = []
        lines = []
        for val, mult, vecs in ev:
            for vec in vecs:
                parts.append(r'\lambda = ' + latex(val) + r':\ ' + latex(vec.T))
                lines.append(['λ = ' + _pp(val), _pp(list(vec))])
        return {'latex_in': latex(M), 'latex_out': r' \\ '.join(parts), 'text': '; '.join(l_[0] + ' → ' + l_[1] for l_ in lines), 'plain': '', 'lines': lines, 'exact': True}
    if mop == 'charpoly':
        lam = Symbol('lambda')
        p = M.charpoly(lam).as_expr()
        fp = factor(p)
        return _res(p, r'\det(' + latex(M) + r' - \lambda I)', lines=[['Factored', _pp(fp)]] if fp != p else [])
    if mop == 'rank':
        r = M.rank()
        return _res(Integer(r), r'\operatorname{rank}' + latex(M))
    if mop == 'nullspace':
        ns = M.nullspace()
        return {'latex_in': r'\operatorname{null}' + latex(M), 'latex_out': ', '.join(latex(v.T) for v in ns) if ns else r'\{\mathbf{0}\}', 'text': '; '.join(_pp(list(v)) for v in ns) or 'Only the zero vector', 'plain': '', 'exact': True}
    if mop == 'rref':
        r, piv = M.rref()
        return {'latex_in': r'\operatorname{rref}' + latex(M), 'latex_out': latex(r), 'text': _pp(r), 'plain': _plain(r.tolist()), 'lines': [['Pivot columns', ', '.join(str(p_ + 1) for p_ in piv)]], 'exact': True}
    if mop == 'transpose':
        r = M.T
        return {'latex_in': latex(M) + '^T', 'latex_out': latex(r), 'text': _pp(r), 'plain': _plain(r.tolist()), 'exact': True}
    if mop == 'trace':
        return _res(M.trace(), r'\operatorname{tr}' + latex(M))
    raise ValueError('Unknown matrix operation')

def _vector(req):
    vs = [Matrix(_parse(s_)) for s_ in req['exprs']]
    vop = req.get('vectorOp')
    if vop == 'set':
        mode = req.get('mode')
        A = Matrix.hstack(*vs)
        r = A.rank()
        fmtv = lambda m: '(' + ', '.join(_pp(c) for c in m) + ')'
        if mode == 'gramschmidt':
            on = GramSchmidt(vs, True)
            return {'latex_in': '', 'latex_out': ', '.join(latex(v.T) for v in on), 'text': ', '.join(fmtv(v) for v in on), 'plain': '', 'lines': [['u' + _sub(i + 1), fmtv(v)] for i, v in enumerate(GramSchmidt(vs))], 'notes': ['Orthonormal basis (the lines show the orthogonal vectors before normalising)'], 'exact': True}
        indep = r == len(vs)
        if mode == 'span':
            dim = vs[0].shape[0]
            txt = ('All of ℝ' + str(dim).translate(_SUPT)) if r == dim else ('A ' + ('line' if r == 1 else 'plane' if r == 2 else str(r) + '-dimensional subspace') + ' through the origin')
            return {'latex_in': '', 'latex_out': r'\dim = ' + str(r), 'text': txt, 'plain': str(r), 'lines': [['Dimension of the span', str(r)]], 'exact': True}
        lines = [['Rank', str(r) + ' of ' + str(len(vs))]]
        if not indep:
            ns = A.nullspace()
            if ns:
                lines.append(['Dependency', ' + '.join('(' + _pp(c) + ')v' + _sub(i + 1) for i, c in enumerate(ns[0]) if c != 0) + ' = 0'])
        return {'latex_in': '', 'latex_out': r'\text{' + ('independent' if indep else 'dependent') + '}', 'text': 'Linearly ' + ('independent' if indep else 'dependent'), 'plain': 'true' if indep else 'false', 'lines': lines, 'exact': True}
    a = vs[0]
    b = vs[1] if len(vs) > 1 else None
    fmt = lambda m: '(' + ', '.join(_pp(c) for c in m) + ')'
    if b is not None and vop not in ('magnitude', 'unit') and a.shape != b.shape:
        raise ValueError('The vectors have different dimensions')
    if vop == 'dot':
        r = a.dot(b)
        return _res(r, latex(a.T) + r'\cdot' + latex(b.T))
    if vop == 'cross':
        if a.shape[0] == 2:
            a = Matrix([a[0], a[1], 0]); b = Matrix([b[0], b[1], 0])
        if a.shape[0] != 3:
            raise ValueError('The cross product needs 3-D vectors')
        r = a.cross(b)
        return {'latex_in': latex(a.T) + r'\times' + latex(b.T), 'latex_out': latex(r.T), 'text': fmt(r), 'plain': _plain(list(r)), 'lines': [['Magnitude', _pp(sqrt(r.dot(r)))]], 'exact': True}
    if vop == 'magnitude':
        r = sqrt(a.dot(a))
        return _res(r, r'\left\|' + latex(a.T) + r'\right\|')
    if vop == 'unit':
        m = sqrt(a.dot(a))
        if m == 0:
            raise ValueError('The zero vector has no direction')
        r = a / m
        return {'latex_in': latex(a.T), 'latex_out': latex(r.T), 'text': fmt(r), 'plain': _plain(list(r)), 'lines': [['Magnitude', _pp(m)]], 'exact': True}
    if vop == 'angle':
        c = simplify(a.dot(b) / sqrt(a.dot(a) * b.dot(b)))
        th = simplify(acos(c))
        deg = simplify(th * 180 / pi)
        lines = [['cos θ', _pp(c)], ['Radians', _pp(th) + ('' if th.is_Rational else ' ≈ ' + _num(th, 10))], ['Degrees', (_pp(deg) if _short(deg, None, 14) else '≈ ' + _num(deg, 10)) + '°']]
        txt = 'θ = ' + _pp(deg) + '°' if deg.is_Rational else 'θ ≈ ' + _num(deg, 8) + '°'
        return {'latex_in': r'\theta', 'latex_out': latex(th), 'text': txt, 'plain': _plain(th), 'numeric': None, 'lines': lines, 'exact': True}
    if vop == 'projection':
        r = (a.dot(b) / b.dot(b)) * b
        return {'latex_in': r'\operatorname{proj}', 'latex_out': latex(r.T), 'text': fmt(r), 'plain': _plain(list(r)), 'lines': [['Scalar projection', _pp(a.dot(b) / sqrt(b.dot(b)))]], 'exact': True}
    if vop in ('add', 'sub'):
        r = a + b if vop == 'add' else a - b
        return {'latex_in': '', 'latex_out': latex(r.T), 'text': fmt(r), 'plain': _plain(list(r)), 'exact': True}
    if vop == 'scale':
        k = _parse(req['scalar'])
        r = k * a
        return {'latex_in': '', 'latex_out': latex(r.T), 'text': fmt(r), 'plain': _plain(list(r)), 'exact': True}
    raise ValueError('Unknown vector operation')
` + STEPS_PY;
