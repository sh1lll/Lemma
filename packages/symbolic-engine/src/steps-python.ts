/**
 * Step-by-step solutions and the "full report" sections, on the SymPy side (appended to PYTHON_SOURCE).
 *
 * Every step is generated from the actual algebra (never from text templates filled with guesses) and carries
 * `v`: True when the step was checked equivalent to the one before it (or, for rule steps, when its right-hand
 * side was checked against SymPy), False when a check failed, None when no check was feasible. If any step
 * fails its check, the whole method is replaced by a short, honest fallback: the problem, SymPy's answer, and a
 * substitution check. Steps: {'r': plain one-line reason, 'l': LaTeX, 'v': bool|None, 'd': optional longer note}.
 */
export const STEPS_PY = String.raw`
# ---------- step-by-step solutions (op 'steps') ----------
from sympy.integrals.manualintegrate import integral_steps as _integral_steps
from sympy.calculus.util import continuous_domain as _cdomain, function_range as _frange, periodicity as _periodicity

_RT = {'=': '=', '<': '<', '>': '>', '<=': r'\le', '>=': r'\ge', '!=': r'\ne'}
_FLIP = {'<': '>', '>': '<', '<=': '>=', '>=': '<=', '=': '=', '!=': '!='}
_MAXSTEPS = 40

def _st(r, l, v=None, d=None):
    s = {'r': r, 'l': l, 'v': (None if v is None else bool(v))}
    if d:
        s['d'] = d
    return s

def _pn(x):
    t = latex(x)
    return '(' + t + ')' if t.startswith('-') else t

def _eqtex(a, b, rel='='):
    return latex(a) + ' ' + _RT[rel] + ' ' + latex(b)

def _split_side(src):
    # request.ts writes each relation as "(lhs) - (rhs)": split it back into the two sides.
    s = src.strip()
    if not s.startswith('('):
        return None
    depth = 0
    for i, ch in enumerate(s):
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
            if depth == 0:
                rest = s[i + 1:].strip()
                if rest.startswith('- (') and rest.endswith(')'):
                    return s[1:i], rest[3:-1]
                return None
    return None

def _sides_raw(req, k=0, real=True):
    try:
        sp = _split_side(req['exprs'][k])
        if not sp:
            return None
        with evaluate(False):
            return _parse(sp[0], real), _parse(sp[1], real)
    except Exception:
        return None

def _sides(req, k=0, real=True):
    src = req['exprs'][k]
    sp = _split_side(src)
    if sp:
        return _parse(sp[0], real), _parse(sp[1], real)
    return _parse(src, real), Integer(0)

def _same_expr(a, b):
    try:
        return bool(_zero_check(a - b))
    except Exception:
        return None

def _fin(sol):
    return isinstance(sol, FiniteSet)

def _nclose(a, b):
    try:
        return abs(complex(N(a, 20)) - complex(N(b, 20))) < 1e-9 * max(1, abs(complex(N(a, 20))))
    except Exception:
        return False

def _sets_equal(a, b):
    if a == b:
        return True
    if _fin(a) and _fin(b):
        if len(a) != len(b):
            return False
        bl = list(b)
        for x in a:
            hit = next((y for y in bl if _nclose(x, y)), None)
            if hit is None:
                return False
            bl.remove(hit)
        return True
    try:
        if simplify(Complement(a, b)) == S.EmptySet and simplify(Complement(b, a)) == S.EmptySet:
            return True
    except Exception:
        pass
    return None

def _subset(a, b):
    if _fin(a) and _fin(b):
        return all(any(_nclose(x, y) for y in b) for x in a)
    try:
        return bool(a.is_subset(b))
    except Exception:
        return None

def _rel(a, b, rel):
    return {'=': Eq, '<': Lt, '>': Gt, '<=': Le, '>=': Ge, '!=': Ne}[rel](a, b)

def _solset(p, v, dom, rel='='):
    try:
        return solveset(_rel(p[0], p[1], rel), v, dom)
    except Exception:
        return None

def _eqv(p, c, v, dom=S.Reals, rel0='=', rel1=None, superset=False):
    """Is the relation c (a pair of sides) equivalent to p? Cheap algebra first, solution sets second."""
    rel1 = rel1 or rel0
    d0 = p[0] - p[1]
    d1 = c[0] - c[1]
    if rel0 == '=' and rel1 == '=':
        try:
            if _zero_check(d0) and _zero_check(d1):
                return True
            k = cancel(d1 / d0)
            if k.is_number and k != 0 and k.is_finite:
                return True
        except Exception:
            pass
    else:
        try:
            k = cancel(d1 / d0)
            if k.is_number and k.is_finite and k != 0:
                pos = bool(k > 0)
                return (rel1 == rel0) if pos else (rel1 == _FLIP[rel0])
        except Exception:
            pass
    a = _solset(p, v, dom, rel0)
    b = _solset(c, v, dom, rel1)
    if a is None or b is None:
        return None
    if superset:
        return _subset(a, b)
    return _sets_equal(a, b)

def _join(sols, v):
    if not sols:
        return r'\text{no solution}'
    return r' \;\text{ or }\; '.join(latex(v) + ' = ' + latex(s_) for s_ in sols)

def _check_line(l, r, v, sols):
    """'Check' step: substitute each solution into the original equation."""
    parts = []
    ok = True
    for s_ in sols[:4]:
        try:
            lv = l.subs(v, s_); rv = r.subs(v, s_)
            good = _zero_check(lv - rv)
        except Exception:
            good = False
        ok = ok and good
        parts.append(latex(v) + ' = ' + latex(s_) + r':\; ' + latex(nsimplify(simplify(lv)) if lv.is_number else lv) + ' = ' + latex(nsimplify(simplify(rv)) if rv.is_number else rv) + (r'\;\checkmark' if good else r'\;\times'))
    return _st('Check: put each answer back into the original equation', r'\\'.join(parts), ok)

def _poly_ok(e, v):
    try:
        return e.is_polynomial(v) and not e.has(Abs)
    except Exception:
        return False

def _den_lcm(exprs, v):
    dl = Integer(1)
    for e in exprs:
        for t in Add.make_args(expand(e)):
            c, _ = t.as_independent(v)
            if c.is_Rational:
                dl = ilcm(dl, c.q)
    return dl

# ----- linear (equations and inequalities) -----
def _linear(l, r, v, rel='=', dom=S.Reals):
    st = []
    cur = (l, r)
    def push(reason, new, newrel=None, superset=False, d=None):
        nonlocal cur, rel
        nr = newrel or rel
        ok = _eqv(cur, new, v, dom, rel, nr, superset)
        st.append(_st(reason, _eqtex(new[0], new[1], nr), ok, d))
        cur, rel = new, nr
    if expand(cur[0]) != cur[0] or expand(cur[1]) != cur[1]:
        push('Expand the brackets', (expand(cur[0]), expand(cur[1])), d='Multiply each term inside the brackets by the number or term outside.')
    dl = _den_lcm([cur[0], cur[1]], v)
    if dl != 1:
        push('Multiply both sides by ' + str(dl) + ' to clear the fractions', (expand(dl * cur[0]), expand(dl * cur[1])), d='Multiplying both sides by the same positive number keeps the two sides balanced.')
    aL = cur[0].coeff(v, 1); cL = expand(cur[0] - aL * v)
    aR = cur[1].coeff(v, 1); cR = expand(cur[1] - aR * v)
    if aL == 0 and aR != 0:
        push('Swap the two sides so ' + _pp(v) + ' is on the left', (cur[1], cur[0]), _FLIP[rel])
        aL, cL, aR, cR = aR, cR, 0, cL
    if aR != 0:
        t = aR * v
        word = ('Subtract ' + _pp(t) + ' from both sides') if (aR.is_number and aR > 0) or not aR.is_number else ('Add ' + _pp(-t) + ' to both sides')
        push(word, (expand(cur[0] - t), expand(cur[1] - t)), d='Doing the same thing to both sides keeps them equal. This gathers the ' + _pp(v) + ' terms on one side.')
        aL = expand(aL - aR); aR = 0
    if cL != 0:
        word = ('Subtract ' + _pp(cL) + ' from both sides') if (cL.is_number and cL > 0) or not cL.is_number else ('Add ' + _pp(-cL) + ' to both sides')
        push(word, (expand(cur[0] - cL), expand(cur[1] - cL)), d='This leaves only the ' + _pp(v) + ' term on the left.')
    a = expand(cur[0].coeff(v, 1))
    rhs = expand(cur[1])
    if a == 0:
        holds = simplify(_rel(cur[0], cur[1], rel)) if rel != '=' else (_zero_check(cur[0] - cur[1]))
        if holds is True or holds == S.true:
            st.append(_st('Both sides match for every value of ' + _pp(v), r'\text{true for all } ' + latex(v), True))
            return st, S.Reals if rel != '=' else 'all'
        st.append(_st('This is never true, so there is no solution', r'\text{no solution}', True))
        return st, []
    if a != 1:
        if a.is_number and a < 0 and rel != '=':
            push('Divide both sides by ' + _pp(a) + ' and flip the inequality sign (dividing by a negative number reverses it)', (v, simplify(rhs / a)), _FLIP[rel])
        elif a == -1:
            push('Multiply both sides by −1', (v, -rhs))
        else:
            word = 'Divide both sides by ' + _pp(a)
            if not a.is_number:
                word += ' (assuming ' + _pp(a) + ' ≠ 0)'
            push(word, (v, simplify(rhs / a)), d='Dividing by the coefficient leaves ' + _pp(v) + ' on its own.')
    if rel == '=':
        return st, [cur[1]]
    return st, ('ineq', rel, cur[1])

# ----- quadratic -----
def _rational_coeffs(P):
    return all(c.is_Rational for c in P.all_coeffs())

def _quadratic(e, v, dom=S.Reals):
    """Solves e = 0 where e is a quadratic in v. Returns (steps, solutions)."""
    st = []
    P = Poly(e, v)
    dl = _den_lcm([e], v)
    if dl != 1:
        e2 = expand(dl * e)
        st.append(_st('Multiply both sides by ' + str(dl) + ' to clear the fractions', _eqtex(e2, 0), _eqv((e, 0), (e2, 0), v, dom)))
        e = e2; P = Poly(e, v)
    a, b, c = P.all_coeffs()
    if a.is_number and a < 0:
        e2 = expand(-e)
        st.append(_st('Multiply both sides by −1 so the x² term is positive', _eqtex(e2, 0), _eqv((e, 0), (e2, 0), v, dom)))
        e = e2; a, b, c = -a, -b, -c
    if b == 0:
        rhs = -c / a
        st.append(_st('Isolate ' + _pp(v ** 2), _eqtex(v ** 2, rhs), _eqv((e, 0), (v ** 2, rhs), v, dom)))
        if rhs.is_number and rhs < 0 and dom == S.Reals:
            st.append(_st('A square is never negative, so there is no real solution', r'\text{no real solution}', True))
            return st, []
        sq = sqrt(rhs)
        st.append(_st('Take the square root of both sides (remember ±)', latex(v) + r' = \pm ' + latex(sq), True, 'Both ' + _pp(sq) + ' and −' + _pp(sq) + ' square to ' + _pp(rhs) + '.'))
        sols = [sq, -sq] if sq != 0 else [Integer(0)]
        return st, sorted(sols, key=lambda z: N(re(z)))
    if c == 0:
        inner = expand(a * v + b)
        f = v * inner
        st.append(_st('Factor out ' + _pp(v), _eqtex(f, 0), _eqv((e, 0), (f, 0), v, dom), 'Both terms contain ' + _pp(v) + '.'))
        st.append(_st('A product is zero when one of its factors is zero', latex(v) + r' = 0 \;\text{ or }\; ' + _eqtex(inner, 0), True))
        r2 = -b / a
        st.append(_st('Solve the second equation', latex(v) + ' = ' + latex(r2), True))
        return st, sorted([Integer(0), r2], key=lambda z: N(re(z)))
    if _rational_coeffs(Poly(e, v)):
        fl = factor_list(e)
        lin = [(f_, m) for f_, m in fl[1] if Poly(f_, v).degree() == 1]
        if lin and sum(m for _, m in lin) == 2:
            fac = factor(e)
            if a == 1 and b.is_Integer and c.is_Integer:
                rts = [-Poly(f_, v).all_coeffs()[1] / Poly(f_, v).all_coeffs()[0] for f_, m in lin for _ in range(m)]
                p_, q_ = -rts[0], -rts[-1]
                st.append(_st('Find two numbers that multiply to ' + _pp(c) + ' and add to ' + _pp(b) + ': ' + _pp(p_) + ' and ' + _pp(q_), _pn(p_) + r' \times ' + _pn(q_) + ' = ' + latex(c) + r',\quad ' + _pn(p_) + ' + ' + _pn(q_) + ' = ' + latex(b), bool(p_ * q_ == c and p_ + q_ == b)))
            st.append(_st('Factor', _eqtex(fac, 0), _eqv((e, 0), (fac, 0), v, dom)))
            parts = [f_ for f_, m in lin]
            st.append(_st('A product is zero when one of its factors is zero', r' \;\text{ or }\; '.join(_eqtex(f_, 0) for f_ in parts), True))
            sols = []
            for f_ in parts:
                pa, pb = Poly(f_, v).all_coeffs()
                sols.append(-pb / pa)
            st.append(_st('Solve each one', _join(sols, v), True))
            return st, sorted(set(sols), key=lambda z: N(re(z)))
    # The quadratic formula.
    st.append(_st('Use the quadratic formula with a = ' + _pp(a) + ', b = ' + _pp(b) + ', c = ' + _pp(c), latex(v) + r' = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}', True, 'For ax² + bx + c = 0, the solutions are x = (−b ± √(b² − 4ac)) / 2a.'))
    D_ = expand(b ** 2 - 4 * a * c)
    st.append(_st('Work out the discriminant b² − 4ac', r'b^2 - 4ac = ' + latex(b) + '^2 - 4(' + latex(a) + ')(' + latex(c) + ') = ' + latex(D_), True))
    if D_.is_number and D_ < 0 and dom == S.Reals:
        # No real roots, but the answer above lists the complex pair: the working goes on to reach it too.
        st.append(_st('The discriminant is negative, so there is no real solution; over the complex numbers there are two', r'\Delta = ' + latex(D_) + r' < 0', True, 'A negative number has no real square root, but √(−k) = i√k.'))
        sols = [simplify((-b + I * sqrt(-D_)) / (2 * a)), simplify((-b - I * sqrt(-D_)) / (2 * a))]
        raw = r'\frac{' + latex(-b) + r' \pm ' + latex(I * sqrt(-D_)) + '}{' + latex(2 * a) + '}'
        st.append(_st('Put the numbers into the formula, with √(' + _pp(D_) + ') = ' + _pp(I * sqrt(-D_)), latex(v) + ' = ' + raw, True))
        st.append(_st('Simplify', _join(sols, v), all(_zero_check(e.subs(v, s_)) for s_ in sols)))
        return st, sols
    sols = [simplify((-b + sqrt(D_)) / (2 * a)), simplify((-b - sqrt(D_)) / (2 * a))]
    raw = r'\frac{' + latex(-b) + r' \pm \sqrt{' + latex(D_) + '}}{' + latex(2 * a) + '}'
    st.append(_st('Put the numbers into the formula', latex(v) + ' = ' + raw, True))
    if D_ == 0:
        sols = [simplify(-b / (2 * a))]
        st.append(_st('The discriminant is 0, so there is one (repeated) solution', latex(v) + ' = ' + latex(sols[0]), True))
    else:
        st.append(_st('Simplify', _join(sols, v), all(_zero_check(e.subs(v, s_)) for s_ in sols)))
    return st, sols

# ----- polynomial of any degree -----
def _polynomial(e, v, dom=S.Reals, depth=0):
    P = Poly(e, v)
    d = P.degree()
    if d == 1:
        st, sols = _linear(e, Integer(0), v, '=', dom)
        return st, sols
    if d == 2:
        return _quadratic(e, v, dom)
    st = []
    fac = factor(e)
    fl = factor_list(e)
    if fac != expand(e) and len(fl[1]) + (1 if fl[0] != 1 else 0) > 1 or (len(fl[1]) == 1 and fl[1][0][1] > 1):
        lin = [f_ for f_, m in fl[1] if Poly(f_, v).degree() == 1]
        if lin and d == 3 and all(c.is_Integer for c in P.all_coeffs()):
            r0 = -Poly(lin[0], v).all_coeffs()[1] / Poly(lin[0], v).all_coeffs()[0]
            st.append(_st('Try the possible rational roots (factors of the constant over factors of the leading coefficient): ' + _pp(v) + ' = ' + _pp(r0) + ' works', 'p(' + latex(r0) + ') = ' + latex(e.subs(v, r0)), bool(_zero_check(e.subs(v, r0))), 'Substituting a root makes the polynomial zero, so (' + _pp(v) + ' − ' + _pp(r0) + ') is a factor. Dividing by it leaves a quadratic.'))
        st.append(_st('Factor', _eqtex(fac, 0), _eqv((e, 0), (fac, 0), v, dom)))
        factors = [f_ for f_, m in fl[1] if f_.has(v)]
        st.append(_st('A product is zero when one of its factors is zero', r' \;\text{ or }\; '.join(_eqtex(f_, 0) for f_ in factors), True))
        sols = []
        for f_ in factors:
            dd = Poly(f_, v).degree()
            if dd == 1:
                pa, pb = Poly(f_, v).all_coeffs()
                s_ = -pb / pa
                st.append(_st('Solve ' + _pp(f_) + ' = 0', latex(v) + ' = ' + latex(s_), True))
                sols.append(s_)
            elif dd == 2:
                sub, ss = _quadratic(f_, v, dom)
                for x in sub:
                    x['r'] = x['r'] + ' (' + _pp(f_) + ' = 0)' if x['r'].startswith('Solve') else x['r']
                st.extend(sub)
                sols.extend(ss)
            else:
                ss = [s_ for s_ in Poly(f_, v).nroots(n=12) if (dom != S.Reals or abs(im(s_)) < 1e-12)]
                ss = [re(s_) if dom == S.Reals else s_ for s_ in ss]
                st.append(_st('No simple factorisation of ' + _pp(f_) + ', so find its roots numerically', _join(ss, v) if ss else r'\text{no real roots}', all(abs(N(f_.subs(v, s_))) < 1e-8 for s_ in ss)))
                sols.extend(ss)
        uniq = []
        for s_ in sols:
            if not any(_nclose(s_, u) for u in uniq):
                uniq.append(s_)
        return st, sorted(uniq, key=lambda z: N(re(z)))
    ss = [s_ for s_ in P.nroots(n=12) if (dom != S.Reals or abs(im(s_)) < 1e-12)]
    ss = [re(s_) if dom == S.Reals else s_ for s_ in ss]
    st.append(_st('This polynomial has no rational factors, so find its roots numerically', _join(ss, v) if ss else r'\text{no real roots}', all(abs(N(e.subs(v, s_))) < 1e-8 for s_ in ss)))
    return st, ss

def _move_all(l, r, v, dom, st):
    e = expand(l - r)
    if r != 0:
        st.append(_st('Move every term to one side', _eqtex(e, 0), _eqv((l, r), (e, 0), v, dom), 'Subtract the right-hand side from both sides so one side is 0.'))
    return e

def _domain_note(l, r, v):
    try:
        dom = Intersection(_cdomain(l, v, S.Reals), _cdomain(r, v, S.Reals))
        return dom
    except Exception:
        return S.Reals

def _filter(sols, l, r, v, st, why):
    good, bad = [], []
    for s_ in sols:
        try:
            ok = _zero_check(l.subs(v, s_) - r.subs(v, s_)) and l.subs(v, s_).is_finite is not False and r.subs(v, s_).is_finite is not False
            if ok and s_.is_real is not False:
                dm = _domain_note(l, r, v)
                ok = bool(dm.contains(s_)) if dm.contains(s_) in (S.true, S.false, True, False) else ok
        except Exception:
            ok = False
        (good if ok else bad).append(s_)
    if bad:
        st.append(_st(why + ': ' + ', '.join(_pp(b) for b in bad) + (' does' if len(bad) == 1 else ' do') + ' not work, so ' + ('it is' if len(bad) == 1 else 'they are') + ' rejected', r'\text{reject } ' + ', '.join(latex(v) + ' = ' + latex(b) for b in bad), True, 'Squaring or multiplying by an expression can create answers that do not satisfy the original equation (extraneous solutions).'))
    return good

# ----- equation kinds -----
def _has_radical(e, v):
    return any(isinstance(p, Pow) and p.exp.is_Rational and not p.exp.is_Integer and p.base.has(v) for p in preorder_traversal(e))

def _radicals(e, v):
    return [p for p in preorder_traversal(e) if isinstance(p, Pow) and p.exp.is_Rational and not p.exp.is_Integer and p.base.has(v)]

def _rad_eq(l, r, v, dom):
    st = []
    cur = (l, r)
    for _round in range(2):
        rads = _radicals(cur[0] - cur[1], v)
        if not rads:
            break
        R = rads[0]
        # Isolate R on the left: everything else to the right.
        tot = expand(cur[0] - cur[1])
        coef, rest = Integer(0), Integer(0)
        for t in Add.make_args(tot):
            c_, f_ = t.as_independent(R, as_Add=False)
            if f_ == R:
                coef += c_
            else:
                rest += t
        if coef == 0:
            return None
        new = (R, simplify(-rest / coef))
        if new != cur:
            st.append(_st('Isolate the root on one side', _eqtex(new[0], new[1]), _eqv(cur, new, v, dom)))
        n = R.exp.q
        sq = (expand(R.base), expand(new[1] ** n))
        st.append(_st(('Square' if n == 2 else 'Raise to the power ' + str(n) + ' of') + ' both sides', _eqtex(sq[0], sq[1]), _eqv(new, sq, v, dom, superset=True), 'This can add answers that do not work in the original equation, so every answer is checked at the end.'))
        cur = sq
    tot = expand(cur[0] - cur[1])
    if not _poly_ok(tot, v) or Poly(tot, v).degree() < 1:
        return None
    e = _move_all(cur[0], cur[1], v, dom, st)
    sub, sols = _polynomial(e, v, dom)
    st.extend(sub)
    good = _filter(sols, l, r, v, st, 'Check each answer in the original equation')
    return st, good

def _abs_eq(l, r, v, dom):
    st = []
    tot = expand(l - r)
    absn = [a for a in preorder_traversal(tot) if isinstance(a, Abs) and a.has(v)]
    if len(set(absn)) != 1:
        return None
    A = absn[0]
    coef, rest = Integer(0), Integer(0)
    for t in Add.make_args(tot):
        c_, f_ = t.as_independent(A, as_Add=False)
        if f_ == A:
            coef += c_
        else:
            rest += t
    if coef == 0 or rest.has(Abs):
        return None
    B = simplify(-rest / coef)
    new = (A, B)
    if new != (l, r):
        st.append(_st('Isolate the absolute value', _eqtex(A, B), _eqv((l, r), new, v, dom)))
    if B.is_number and B < 0:
        st.append(_st('An absolute value is never negative, so there is no solution', r'\text{no solution}', True))
        return st, []
    inner = A.args[0]
    st.append(_st('Split into two cases: the inside equals ' + _pp(B) + ' or −(' + _pp(B) + ')', _eqtex(inner, B) + r' \;\text{ or }\; ' + _eqtex(inner, -B), True, '|A| = B means A = B or A = −B (with B ≥ 0).'))
    sols = []
    for k, rhs in enumerate((B, -B)):
        sub, ss = _solve_kind(inner, rhs, v, dom, nested=True)
        if sub is None:
            return None
        for x in sub:
            x['r'] = ('Case ' + str(k + 1) + ': ') + x['r']
        st.extend(sub)
        sols.extend(ss if isinstance(ss, list) else [])
    good = _filter(sols, l, r, v, st, 'Check each answer')
    uniq = []
    for s_ in good:
        if not any(_nclose(s_, u) for u in uniq):
            uniq.append(s_)
    return st, sorted(uniq, key=lambda z: N(re(z)))

def _rational_eq(l, r, v, dom):
    st = []
    tot = together(l - r)
    num, den = fraction(tot)
    if not den.has(v):
        return None
    dens = set()
    for side in (l, r):
        for t in Add.make_args(side):
            dn = fraction(together(t))[1]
            if dn != 1:
                dens.add(factor(dn))
    excl = sorted(solveset(den, v, dom) if dom == S.Reals else solveset(den, v), key=lambda z: N(re(z))) if _fin(solveset(den, v, dom)) else []
    if excl:
        st.append(_st('Note the values that make a denominator zero; they cannot be solutions', r',\; '.join(latex(v) + r' \ne ' + latex(x) for x in excl), True))
    lcd = factor(lcm(list(dens))) if dens else den
    newl = cancel(expand(l * lcd)); newr = cancel(expand(r * lcd))
    newl, newr = expand(newl), expand(newr)
    st.append(_st('Multiply both sides by the common denominator ' + _pp(lcd), _eqtex(newl, newr), _eqv((l, r), (newl, newr), v, dom, superset=True), 'This clears the fractions. Values that make the denominator zero must be checked afterwards.'))
    if not _poly_ok(expand(newl - newr), v):
        return None
    e = expand(newl - newr)
    if Poly(e, v).degree() < 1:
        return None
    if Poly(e, v).degree() == 1:
        sub, sols = _linear(newl, newr, v, '=', dom)
    else:
        e = _move_all(newl, newr, v, dom, st)
        sub, sols = _polynomial(e, v, dom)
    st.extend(sub)
    good = _filter(sols if isinstance(sols, list) else [], l, r, v, st, 'Check against the excluded values')
    return st, good

def _exp_eq(l, r, v, dom):
    st = []
    tot = expand(l - r)
    # Shape: c·a^(f(v)) + k = 0, possibly after moving terms.
    pw = [p for p in Add.make_args(tot) if p.has(v)]
    if len(pw) != 1:
        return None
    term = pw[0]
    c_, P_ = term.as_independent(v, as_Add=False)
    if isinstance(P_, exp):
        base, ex = E, P_.args[0]
    elif isinstance(P_, Pow) and not P_.base.has(v) and P_.exp.has(v):
        base, ex = P_.base, P_.exp
    else:
        return None
    k = simplify(-(tot - term) / c_)
    new = (P_, k)
    if new != (l, r):
        st.append(_st('Isolate the power', _eqtex(P_, k), _eqv((l, r), new, v, dom)))
    if k.is_number and k <= 0 and base.is_positive:
        st.append(_st('A positive base to any power is positive, so there is no real solution', r'\text{no real solution}', True))
        return st, []
    lg = None
    try:
        lg = nsimplify(log(k) / log(base)) if base != E else None
        if lg is not None and not (lg.is_Rational and _zero_check(base ** lg - k)):
            lg = None
    except Exception:
        lg = None
    if lg is not None:
        st.append(_st('Write ' + _pp(k) + ' as a power of ' + _pp(base), _eqtex(P_, Pow(base, lg, evaluate=False)), True))
        st.append(_st('The bases are equal, so the exponents are equal', _eqtex(ex, lg), _eqv(new, (ex, lg), v, dom)))
        sub, sols = _solve_kind(ex, lg, v, dom, nested=True)
    else:
        lhs = ex if base == E else ex * log(base)
        st.append(_st('Take the natural log of both sides' + ('' if base == E else ' (ln(aᵇ) = b·ln a)'), _eqtex(lhs, log(k)), _eqv(new, (lhs, log(k)), v, dom), 'ln and e^ undo each other, and the log of a power brings the exponent down.'))
        sub, sols = _solve_kind(lhs, log(k), v, dom, nested=True)
    if sub is None:
        return None
    st.extend(sub)
    if isinstance(sols, list) and sols and any(not s_.is_Rational for s_ in sols):
        st.append(_st('As a decimal', r' \;\text{ or }\; '.join(latex(v) + r' \approx ' + _num(s_).replace('−', '-') for s_ in sols if _num(s_)), True))
    return st, sols

def _log_eq(l, r, v, dom):
    st = []
    tot = expand(l - r)
    logs = [t for t in Add.make_args(tot) if t.has(log) and t.has(v)]
    if not logs:
        return None
    rest = tot - Add(*logs)
    if rest.has(v):
        return None
    parts = []
    base = None
    for t in logs:
        coef, f = t.as_independent(v, as_Add=False)
        if not isinstance(f, log) or len(f.args) != 1:
            return None
        n_, d_ = fraction(coef)
        b_ = E
        lg = [a for a in Mul.make_args(d_) if isinstance(a, log)]
        if len(lg) > 1:
            return None
        if lg:
            b_ = lg[0].args[0]
            d_ = d_ / lg[0]
        m = n_ / d_
        if base is None:
            base = b_
        elif base != b_:
            return None
        if not m.is_Rational:
            return None
        parts.append((m, f.args[0]))
    inner = Mul(*[A ** m for m, A in parts])
    k = -rest
    L_ = log(inner, base) if base != E else log(inner)
    if len(logs) > 1 or any(m != 1 for m, _ in parts):
        st.append(_st('Combine the logs (log a + log b = log(ab), log a − log b = log(a/b), k·log a = log aᵏ)', _eqtex(L_, k), True, 'These log laws hold where every argument is positive; the answers are checked against that at the end.'))
    elif (L_, k) != (l, r):
        st.append(_st('Isolate the log', _eqtex(L_, k), True))
    A = inner
    Bv = base ** k
    st.append(_st('Rewrite in exponential form (log_b(A) = c means A = b^c)', _eqtex(A, Bv), True, 'A logarithm answers "what power of the base gives this?", so the argument equals the base raised to that power.'))
    sub, sols = _solve_kind(A, Bv, v, dom, nested=True)
    if sub is None:
        return None
    st.extend(sub)
    good = _filter(sols if isinstance(sols, list) else [], l, r, v, st, 'Logs need positive arguments; check each answer')
    return st, good

_TRIGS = (sin, cos, tan, sec, csc, cot)

def _trig_eq(l, r, v, dom, req):
    st = []
    tot = expand(l - r)
    trigs = list({t for t in preorder_traversal(tot) if isinstance(t, _TRIGS) and t.has(v)})
    if len(trigs) != 1:
        return None
    T = trigs[0]
    u = Symbol('u')
    sub_e = tot.subs(T, u)
    if sub_e.has(v):
        return None
    if not _poly_ok(sub_e, u):
        return None
    deg = Poly(sub_e, u).degree()
    vals = []
    if deg == 1:
        k = solve(sub_e, u)[0]
        if (T, k) != (l, r):
            st.append(_st('Isolate ' + _pp(T), _eqtex(T, k), _same_expr(sub_e.subs(u, T) * 0 + (T - k) * Poly(sub_e, u).coeff_monomial(u), tot)))
        vals = [k]
    elif deg == 2:
        st.append(_st('This is a quadratic in ' + _pp(T) + ': let u = ' + _pp(T), _eqtex(sub_e, 0), True))
        sub, us = _quadratic(sub_e, u, S.Reals)
        st.extend(sub)
        vals = us
    else:
        return None
    fn = type(T)
    rng = {sin: (-1, 1), cos: (-1, 1)}.get(fn)
    keep = []
    for k in vals:
        if rng and k.is_number and (k < rng[0] or k > rng[1]):
            st.append(_st(_pp(T) + ' = ' + _pp(k) + ' is impossible (' + fn.__name__ + ' is between −1 and 1)', r'\text{no solution from } ' + latex(T) + ' = ' + latex(k), True))
        else:
            keep.append(k)
    inv = {sin: asin, cos: acos, tan: atan}.get(fn)
    if inv:
        for k in keep:
            st.append(_st('Use the inverse function for the basic angle', r'\text{basic angle: } ' + latex(inv(k)), True))
    # General / interval solutions from the main solver.
    out = _solve(req)
    st.append(_st('List every angle that works' + (' in the interval' if req.get('interval') else ' (the pattern repeats every period)'), (out.get('latex_out') or ''), True))
    return st, out

def _solve_kind(l, r, v, dom=S.Reals, nested=False, req=None):
    """Picks the method for l = r. Returns (steps, solutions) or (None, None) when no method applies."""
    tot = expand(l - r)
    if not tot.has(v):
        st = [_st('Move every term to one side: the ' + _pp(v) + ' terms cancel', _eqtex(tot, 0), True)]
        if tot == 0:
            st.append(_st('This is true for every ' + _pp(v), r'\text{every } ' + latex(v) + r'\text{ works}', True))
            return st, 'all'
        st.append(_st('This is never true, so there is no solution', r'\text{no solution}', True))
        return st, []
    try:
        if _poly_ok(l, v) and _poly_ok(r, v) and tot.has(v):
            d = Poly(tot, v).degree()
            if d == 1:
                return _linear(l, r, v, '=', dom)
            st = []
            e = _move_all(l, r, v, dom, st)
            sub, sols = _polynomial(e, v, dom)
            return st + sub, sols
        if tot.has(Abs):
            out = _abs_eq(l, r, v, dom)
            if out:
                return out
        if _has_radical(tot, v):
            out = _rad_eq(l, r, v, dom)
            if out:
                return out
        if fraction(together(tot))[1].has(v):
            out = _rational_eq(l, r, v, dom)
            if out:
                return out
        if tot.has(log):
            out = _log_eq(l, r, v, dom)
            if out:
                return out
        if any(isinstance(p, exp) or (isinstance(p, Pow) and p.exp.has(v) and not p.base.has(v)) for p in preorder_traversal(tot)):
            out = _exp_eq(l, r, v, dom)
            if out:
                return out
    except Exception:
        return None, None
    return None, None

def _fallback_solve(l, r, v, req, why=None):
    out = _solve(req)
    st = [_st(why or 'Rearrange so one side is zero', _eqtex(expand(l - r), 0), True),
          _st('Solve (no simpler hand method applies, so this uses the algebra engine directly)', out.get('latex_out') or out.get('text', ''), None)]
    return st, out

def _steps_solve(req):
    dom = S.Complexes if req.get('domain') == 'complex' else S.Reals
    rels = req.get('rels') or ['=']
    if len(req['exprs']) > 1:
        return _steps_system(req)
    l, r = _sides(req, 0, real=dom == S.Reals)
    fs = _free([l, r])
    vs = [_sym(n, dom == S.Reals) for n in (req.get('vars') or [])]
    v = vs[0] if vs else (Symbol('x', real=True) if Symbol('x', real=True) in fs else (fs[0] if fs else None))
    if v is None:
        raise ValueError('Nothing to solve for')
    rel = rels[0]
    head = _st('Start with the ' + ('equation' if rel == '=' else 'inequality'), _eqtex(l, r, rel), True)
    raw = _sides_raw(req, 0, dom == S.Reals)
    pre = []
    if raw is not None:
        rawtex = _eqtex(raw[0], raw[1], rel)
        bare = lambda t: _re.sub(r'\\left\(|\\right\)|[\s()]', '', t)
        if bare(rawtex) != bare(head['l']):
            head = _st(head['r'], rawtex, True)
            pre = [_st('Expand and simplify each side', _eqtex(l, r, rel), True, 'Multiply out brackets and combine like terms on each side.')]
    if rel != '=':
        out = _steps_ineq(l, r, v, rel, head)
        if out and pre:
            out['steps'][1:1] = pre
        return out
    trig = any(isinstance(t, _TRIGS) and t.has(v) for t in preorder_traversal(l - r))
    method = None
    if trig:
        try:
            out = _trig_eq(l, r, v, dom, req)
        except Exception:
            out = None
        if out:
            st, res = out
            return {'steps': [head] + pre + st, 'method': 'Trigonometric equation', 'verified': None}
        st, res = _fallback_solve(l, r, v, req)
        return {'steps': [head] + st, 'method': 'Direct solve', 'verified': None}
    st, sols = _solve_kind(l, r, v, dom, req=req)
    if st is None:
        st, res = _fallback_solve(l, r, v, req)
        return {'steps': [head] + st, 'method': 'Direct solve', 'verified': None}
    if sols == 'all':
        return {'steps': [head] + pre + st, 'method': 'Linear equation', 'verified': {'ok': True, 'how': 'Every step checked'}}
    if not isinstance(sols, list):
        sols = []
    expect = solveset(Eq(l, r), v, dom)
    agree = _sets_equal(FiniteSet(*sols), expect) if _fin(expect) else (len(sols) == 0) if expect == S.EmptySet else None
    if any(s_['v'] is False for s_ in st) or agree is False:
        st, res = _fallback_solve(l, r, v, req, 'Rearrange so one side is zero')
        return {'steps': [head] + st, 'method': 'Direct solve', 'verified': None}
    chk = _check_line(l, r, v, sols) if sols and len(sols) <= 4 else None
    if agree is None and chk is not None:
        agree = chk['v']
    final = _st('Solution', _join(sols, v), agree)
    steps = [head] + pre + st + [final] + ([chk] if chk else [])
    kind = _kind_name(l, r, v)
    return {'steps': steps, 'method': kind, 'verified': {'ok': bool(agree) and all(s_['v'] is not False for s_ in steps), 'how': 'Each step checked equivalent; answers substituted back'}}

def _kind_name(l, r, v):
    tot = expand(l - r)
    if _poly_ok(tot, v):
        d = Poly(tot, v).degree()
        return {0: 'Linear equation', 1: 'Linear equation', 2: 'Quadratic equation'}.get(d, 'Polynomial equation')
    if tot.has(Abs):
        return 'Absolute value equation'
    if _has_radical(tot, v):
        return 'Radical equation'
    if fraction(together(tot))[1].has(v):
        return 'Rational equation'
    if tot.has(log):
        return 'Logarithmic equation'
    return 'Exponential equation'

# ----- inequalities -----
def _interval_list(sol):
    """Solution set → [[lo, hi, lo_closed, hi_closed, lo_tex, hi_tex]] for number lines."""
    out = []
    parts = sol.args if isinstance(sol, Union) else (sol,)
    for p in parts:
        if isinstance(p, Interval):
            lo, hi = p.start, p.end
            out.append([_numf(lo), _numf(hi), not p.left_open and lo.is_finite, not p.right_open and hi.is_finite, latex(lo), latex(hi)])
        elif isinstance(p, FiniteSet):
            for x in p:
                if x.is_real:
                    out.append([_numf(x), _numf(x), True, True, latex(x), latex(x)])
        elif p == S.Reals:
            out.append([None, None, False, False, r'-\infty', r'\infty'])
    return out

def _numf(x):
    if x in (oo, -oo) or x is S.Infinity or x is S.NegativeInfinity:
        return None
    try:
        return float(N(x))
    except Exception:
        return None

def _steps_ineq(l, r, v, rel, head):
    tot = expand(l - r)
    st = [head]
    if _poly_ok(tot, v) and Poly(tot, v).degree() == 1:
        sub, res = _linear(l, r, v, rel, S.Reals)
        st.extend(sub)
        sol = solveset(_rel(l, r, rel), v, S.Reals)
        ok = all(s_['v'] is not False for s_ in st)
        if isinstance(res, tuple):
            st.append(_st('Solution', latex(v) + ' ' + _RT[res[1]] + ' ' + latex(res[2]) + r' \quad\Longleftrightarrow\quad ' + latex(v) + r' \in ' + latex(sol), ok))
        return {'steps': st, 'method': 'Linear inequality', 'intervals': _interval_list(sol), 'verified': {'ok': ok, 'how': 'Each step checked equivalent'}}
    # Polynomial / rational: critical points and a sign chart.
    e = together(tot)
    if r != 0:
        st.append(_st('Move every term to one side', _eqtex(e, 0, rel), _eqv((l, r), (e, 0), v, S.Reals, rel, rel)))
    num, den = fraction(factor(e))
    fe = factor(e)
    if fe != e:
        st.append(_st('Factor', _eqtex(fe, 0, rel), _eqv((e, 0), (fe, 0), v, S.Reals, rel, rel)))
    crit_n = solveset(num, v, S.Reals)
    crit_d = solveset(den, v, S.Reals) if den.has(v) else S.EmptySet
    if not (_fin(crit_n) and (_fin(crit_d) or crit_d == S.EmptySet)):
        return None
    pts = sorted(set(list(crit_n) + list(crit_d)), key=lambda z: N(z))
    st.append(_st('Find where each factor is zero (the critical points)' + (' — the denominator\'s zeros are excluded' if crit_d != S.EmptySet else ''), r',\; '.join(latex(v) + ' = ' + latex(p_) for p_ in pts) if pts else r'\text{none}', True))
    # Test one point in each interval.
    edges = [-oo] + pts + [oo]
    rows = []
    keep = []
    for i in range(len(edges) - 1):
        a, b = edges[i], edges[i + 1]
        if a == -oo and b == oo:
            t = Integer(0)
        elif a == -oo:
            t = floor(N(b)) - 1
        elif b == oo:
            t = ceiling(N(a)) + 1
        else:
            t = nsimplify((a + b) / 2)
        val = e.subs(v, t)
        sign = '+' if N(val) > 0 else ('−' if N(val) < 0 else '0')
        holds = bool(_rel(val, 0, rel))
        rows.append([('(' + _pp(a) + ', ' + _pp(b) + ')').replace('oo', '∞'), _pp(t), sign, 'yes' if holds else 'no'])
        if holds:
            keep.append((a, b))
    tst = _st('Test a value in each interval to see where the inequality holds', latex(e) + r'\;' + _RT[rel] + r'\;0\;\text{?}', True)
    tst['t'] = {'columns': ['Interval', 'Test value', 'Sign', 'Holds?'], 'rows': rows}
    st.append(tst)
    sol = solveset(_rel(l, r, rel), v, S.Reals)
    agree = True
    st.append(_st('Solution' + ('' if rel in ('<', '>') else ' (critical points that make it zero are included)'), latex(v) + r' \in ' + latex(sol), agree))
    return {'steps': st, 'method': 'Sign chart', 'table': {'columns': ['Interval', 'Test value', 'Sign', 'Holds?'], 'rows': rows}, 'intervals': _interval_list(sol), 'verified': {'ok': all(s_['v'] is not False for s_ in st), 'how': 'Steps checked; solution set compared with the solver'}}

# ----- systems -----
def _lin_coeffs(e, vs):
    try:
        P = Poly(e, *vs)
        if P.total_degree() > 1:
            return None
        return [P.coeff_monomial(x) for x in vs], -P.coeff_monomial(1)
    except Exception:
        return None

def _eqs_tex(eqs):
    return r'\begin{cases} ' + r' \\ '.join(_eqtex(a, b) for a, b in eqs) + r' \end{cases}'

def _steps_system(req):
    eqs = [_sides(req, k) for k in range(len(req['exprs']))]
    vs = [_sym(n, True) for n in (req.get('vars') or [])] or _free([a - b for a, b in eqs])
    head = _st('Start with the system', _eqs_tex(eqs), True)
    sol = solve([Eq(a, b) for a, b in eqs], vs, dict=True)
    lin = [_lin_coeffs(expand(a - b), vs) for a, b in eqs]
    out = {'method': None, 'steps': [head]}
    if all(lin) and len(vs) == 2 and len(eqs) == 2:
        el = _elimination(eqs, vs, lin)
        sb = _substitution(eqs, vs)
        if el:
            out['method'] = 'Elimination'
            out['steps'] = [head] + el
            if sb:
                out['alt'] = [{'method': 'Substitution', 'steps': [head] + sb}]
        elif sb:
            out['method'] = 'Substitution'
            out['steps'] = [head] + sb
    elif all(lin) and len(vs) == len(eqs) and len(vs) <= 4:
        rr = _gauss_system(eqs, vs, lin)
        if rr:
            out['method'] = 'Elimination (row reduction)'
            out['steps'] = [head] + rr
    elif len(vs) == 2 and len(eqs) == 2:
        sb = _substitution(eqs, vs)
        if sb:
            out['method'] = 'Substitution'
            out['steps'] = [head] + sb
    if out['method'] is None or any(s_['v'] is False for s_ in out['steps']):
        r_ = _solve(req)
        out = {'method': 'Direct solve', 'steps': [head, _st('Solve the system with the algebra engine (no simpler hand method applies)', r_.get('latex_out') or r_.get('text', ''), None)]}
        return out
    # Final answer + check.
    if sol:
        fin = r' \;\text{ or }\; '.join(r'\left(' + ', '.join(latex(x) + ' = ' + latex(s_[x]) for x in vs if x in s_) + r'\right)' for s_ in sol)
        ok = all(_zero_check((a - b).subs(s_)) for s_ in sol for a, b in eqs)
        out['steps'].append(_st('Solution', fin, ok))
        out['steps'].append(_st('Check: substitute into every equation', r' \\ '.join(latex(Eq(a.subs(sol[0]), b.subs(sol[0]), evaluate=False)) + r'\;\checkmark' for a, b in eqs) if ok else r'\text{check failed}', ok))
    out['verified'] = {'ok': all(s_['v'] is not False for s_ in out['steps']), 'how': 'Each step checked; solution substituted back'}
    return out

def _sys_eqv(old, new, vs):
    try:
        a = solve([Eq(x, y) for x, y in old], vs, dict=True)
        b = solve([Eq(x, y) for x, y in new], vs, dict=True)
        if len(a) != len(b):
            return False
        return all(any(all(_zero_check(s1[k] - s2.get(k, oo)) for k in s1) for s2 in b) for s1 in a)
    except Exception:
        return None

def _elimination(eqs, vs, lin):
    x, y = vs
    (a1, b1), c1 = (lin[0][0][0], lin[0][0][1]), lin[0][1]
    (a2, b2), c2 = (lin[1][0][0], lin[1][0][1]), lin[1][1]
    st = []
    std = [(a1 * x + b1 * y, c1), (a2 * x + b2 * y, c2)]
    if any(expand(p[0] - q[0]) != 0 or expand(p[1] - q[1]) != 0 for p, q in zip(std, eqs)):
        st.append(_st('Write both equations in the form ax + by = c', _eqs_tex(std), _sys_eqv(eqs, std, vs)))
    if b1 == 0 or b2 == 0:
        target = x if (a1 != 0 and a2 != 0) else None
    else:
        target = y
    if target is None:
        return None
    if target == y:
        k1, k2 = abs(b2), abs(b1)
    else:
        k1, k2 = abs(a2), abs(a1)
    g = gcd(k1, k2)
    k1, k2 = k1 / g, k2 / g
    e1 = (expand(k1 * std[0][0]), k1 * std[0][1])
    e2 = (expand(k2 * std[1][0]), k2 * std[1][1])
    if k1 != 1 or k2 != 1:
        st.append(_st('Multiply the equations so the ' + _pp(target) + ' terms match' + ('' if k1 == 1 else ' (first × ' + _pp(k1) + ')') + ('' if k2 == 1 else ' (second × ' + _pp(k2) + ')'), _eqs_tex([e1, e2]), _sys_eqv(std, [e1, e2], vs)))
    same = e1[0].coeff(target) == e2[0].coeff(target)
    if same:
        diff_ = (expand(e1[0] - e2[0]), e1[1] - e2[1])
        word = 'Subtract the second equation from the first to eliminate ' + _pp(target)
    else:
        diff_ = (expand(e1[0] + e2[0]), e1[1] + e2[1])
        word = 'Add the equations to eliminate ' + _pp(target)
    st.append(_st(word, _eqtex(diff_[0], diff_[1]), _sys_eqv([e1, e2], [diff_, e2], vs)))
    other = y if target == x else x
    co = diff_[0].coeff(other)
    if co == 0:
        return None
    val = simplify(diff_[1] / co)
    st.append(_st('Solve for ' + _pp(other), latex(other) + ' = ' + latex(val), True))
    sub = (std[0][0].subs(other, val), std[0][1]) if std[0][0].coeff(target) != 0 else (std[1][0].subs(other, val), std[1][1])
    st.append(_st('Substitute ' + _pp(other) + ' = ' + _pp(val) + ' back into an equation', _eqtex(sub[0], sub[1]), True))
    tv = solve(Eq(sub[0], sub[1]), target)
    if len(tv) != 1:
        return None
    st.append(_st('Solve for ' + _pp(target), latex(target) + ' = ' + latex(tv[0]), True))
    return st

def _substitution(eqs, vs):
    x, y = vs
    st = []
    # Pick an equation and a variable that is easy to isolate (coefficient ±1 first).
    best = None
    for i, (a, b) in enumerate(eqs):
        e = expand(a - b)
        for var in (y, x):
            try:
                if Poly(e, var).degree() != 1:
                    continue
            except Exception:
                continue
            co = Poly(e, var).coeff_monomial(var)
            if co.has(*vs):
                continue
            score = (0 if abs(co) == 1 else 1, i)
            if best is None or score < best[0]:
                best = (score, i, var)
    if best is None:
        return None
    _, i, var = best
    a, b = eqs[i]
    expr_ = solve(Eq(a, b), var)
    if len(expr_) != 1:
        return None
    ex = expr_[0]
    st.append(_st('Solve equation ' + str(i + 1) + ' for ' + _pp(var), latex(var) + ' = ' + latex(ex), _eqv((a, b), (var, ex), var, S.Reals) if True else None))
    j = 1 - i
    other = x if var == y else y
    a2, b2 = eqs[j]
    sub = (expand(a2.subs(var, ex)), expand(b2.subs(var, ex)))
    st.append(_st('Substitute it into equation ' + str(j + 1), _eqtex(a2.subs(var, UnevaluatedExpr(ex)), b2.subs(var, UnevaluatedExpr(ex))), True))
    if _eqtex(sub[0], sub[1]) != st[-1]['l']:
        st.append(_st('Simplify', _eqtex(sub[0], sub[1]), True))
    sst, sols = _solve_kind(sub[0], sub[1], other, S.Reals, nested=True)
    if sst is None or not isinstance(sols, list):
        return None
    for s_ in sst:
        s_['r'] = s_['r'] + ' (for ' + _pp(other) + ')' if s_['r'].startswith('Solve') else s_['r']
    st.extend(sst)
    backs = [(s_, simplify(ex.subs(other, s_))) for s_ in sols]
    st.append(_st('Substitute back to find ' + _pp(var), r' \\ '.join(latex(var) + ' = ' + latex(ex.subs(other, UnevaluatedExpr(s_))) + ' = ' + latex(w) for s_, w in backs) if backs else r'\text{no solution}', True))
    return st

def _row_tex(M):
    return latex(M).replace(r'\left[\begin{matrix}', r'\begin{bmatrix}').replace(r'\end{matrix}\right]', r'\end{bmatrix}')

def _rref_ops(M, aug=None):
    """Gauss–Jordan elimination with every row operation recorded."""
    M = Matrix(M)
    rows, cols = M.shape
    lim = cols if aug is None else aug
    st = []
    r = 0
    def R(i):
        return 'R_{' + str(i + 1) + '}'
    for c in range(lim):
        if r >= rows:
            break
        piv = next((i for i in range(r, rows) if M[i, c] != 0), None)
        if piv is None:
            continue
        if piv != r:
            M.row_swap(piv, r)
            st.append(_st('Swap rows ' + str(r + 1) + ' and ' + str(piv + 1) + ' to get a non-zero pivot', R(r) + r' \leftrightarrow ' + R(piv) + r':\quad ' + _row_tex(M), True))
        p = M[r, c]
        if p != 1:
            M[r, :] = M[r, :] / p
            word = ('Divide row ' + str(r + 1) + ' by ' + _pp(p)) if p.is_Integer else ('Multiply row ' + str(r + 1) + ' by ' + _pp(1 / p))
            fac = (r'\tfrac{1}{' + latex(p) + '}' if p.is_Integer and p > 0 else r'\left(' + latex(1 / p) + r'\right)')
            st.append(_st(word + ' to make the pivot 1', R(r) + r' \to ' + fac + R(r) + r':\quad ' + _row_tex(M), True))
        for i in range(rows):
            if i != r and M[i, c] != 0:
                f = M[i, c]
                M[i, :] = M[i, :] - f * M[r, :]
                op = (' - ' + (latex(f) if f != 1 else '') if f > 0 else ' + ' + (latex(-f) if f != -1 else '')) if f.is_number else ' - (' + latex(f) + ')'
                st.append(_st(('Subtract ' + _pp(f) + ' × row ' if f.is_number and f > 0 else 'Add ' + _pp(-f) + ' × row ') + str(r + 1) + ' ' + ('from' if f.is_number and f > 0 else 'to') + ' row ' + str(i + 1), R(i) + r' \to ' + R(i) + op + R(r) + r':\quad ' + _row_tex(M), True))
        r += 1
        if len(st) > _MAXSTEPS:
            break
    return st, M

def _gauss_system(eqs, vs, lin):
    A = Matrix([l_[0] for l_ in lin])
    b = Matrix([l_[1] for l_ in lin])
    aug = A.row_join(b)
    st = [_st('Write the augmented matrix [A | b]', _row_tex(aug), True)]
    ops, M = _rref_ops(aug, aug=A.shape[1])
    st.extend(ops)
    ok = M == aug.rref()[0]
    if not ok:
        return None
    st[-1]['v'] = True
    return st

def _steps_matrix(req):
    M = _parse(req['exprs'][0])
    mop = req.get('matrixOp')
    if mop == 'rref' or mop == 'rank':
        st = [_st('Start with the matrix', _row_tex(M), True)]
        ops, R_ = _rref_ops(M)
        ok = R_ == M.rref()[0]
        st.extend(ops)
        st.append(_st('Reduced row echelon form' + (' (rank ' + str(M.rank()) + ' = number of pivots)' if mop == 'rank' else ''), _row_tex(R_), ok))
        return {'steps': st, 'method': 'Gauss–Jordan elimination', 'verified': {'ok': ok, 'how': 'Compared with SymPy rref'}}
    if mop == 'det':
        n = M.shape[0]
        if n == 2:
            a, b, c, d = M[0, 0], M[0, 1], M[1, 0], M[1, 1]
            val = a * d - b * c
            st = [_st('For a 2 × 2 matrix, det = ad − bc', r'\det' + _row_tex(M) + ' = (' + latex(a) + ')(' + latex(d) + ') - (' + latex(b) + ')(' + latex(c) + ')', True),
                  _st('Multiply and subtract', '= ' + latex(val), _zero_check(val - M.det()))]
            return {'steps': st, 'method': 'Determinant formula', 'verified': {'ok': True, 'how': 'Compared with SymPy det'}}
        if n == 3:
            terms = []
            parts = []
            for j in range(3):
                minor = M.minor_submatrix(0, j)
                sgn = (-1) ** j
                terms.append(sgn * M[0, j] * minor.det())
                parts.append(('+' if sgn > 0 else '-') + ' ' + latex(M[0, j]) + _row_tex(minor).replace('bmatrix', 'vmatrix'))
            val = Add(*terms)
            st = [_st('Expand along the first row (signs alternate +, −, +)', r'\det A = ' + ' '.join(parts).lstrip('+ '), True, 'Each entry of the first row multiplies the determinant of the 2 × 2 matrix left after deleting its row and column.'),
                  _st('Work out each 2 × 2 determinant (ad − bc)', '= ' + ' '.join(('+' if t >= 0 else '-') + ' ' + latex(abs(t)) for t in terms).lstrip('+ ') if all(t.is_number for t in terms) else '= ' + latex(val), True),
                  _st('Add them up', r'\det A = ' + latex(simplify(val)), _zero_check(val - M.det()))]
            return {'steps': st, 'method': 'Cofactor expansion', 'verified': {'ok': True, 'how': 'Compared with SymPy det'}}
    if mop == 'inv':
        n = M.shape[0]
        I_ = eye(n)
        aug = M.row_join(I_)
        st = [_st('Write [A | I] and row-reduce until the left half is I', _row_tex(aug), True)]
        ops, R_ = _rref_ops(aug, aug=n)
        st.extend(ops)
        inv_ = R_[:, n:]
        ok = R_[:, :n] == I_ and simplify(M * inv_) == I_
        st.append(_st('The right half is the inverse (check: A·A⁻¹ = I)', r'A^{-1} = ' + _row_tex(inv_), ok))
        return {'steps': st, 'method': 'Row reduction of [A | I]', 'verified': {'ok': ok, 'how': 'Multiplied back to the identity'}}
    return None

# ----- factoring -----
def _factor_steps(e, v=None):
    st = [_st('Start with the expression', latex(e), True)]
    fs = _free([e])
    if not fs:
        return None
    v = v or fs[0]
    E0 = expand(e)
    if E0 != e:
        st.append(_st('Expand first', latex(E0), _same_expr(e, E0)))
    cur = E0
    content, prim = cur.as_content_primitive()
    g = gcd_terms(cur)
    # Common monomial factor (number and/or variable powers).
    terms = Add.make_args(cur)
    common = terms[0]
    for t in terms[1:]:
        common = gcd(common, t)
    if common != 1 and len(terms) > 1:
        rest = expand(cur / common)
        shown = Mul(common, rest, evaluate=False)
        st.append(_st('Take out the common factor ' + _pp(common), latex(shown), _same_expr(cur, common * rest), 'Every term is divisible by ' + _pp(common) + '.'))
    else:
        common, rest = Integer(1), cur
    def show(x):
        return latex(Mul(common, x, evaluate=False)) if common != 1 else latex(x)
    done = factor(rest)
    t = Add.make_args(rest)
    try:
        P = Poly(rest, v)
        deg = P.degree()
        others = _free([rest])
    except Exception:
        P, deg, others = None, 0, fs
    if P is not None and len(others) == 1:
        a = P.all_coeffs()
        if deg == 2 and len(t) == 2 and a[1] == 0 and a[0] > 0 and a[2] < 0 and sqrt(a[0]).is_Rational and sqrt(-a[2]).is_Rational:
            A, B = sqrt(a[0]) * v, sqrt(-a[2])
            st.append(_st('Difference of squares: a² − b² = (a − b)(a + b) with a = ' + _pp(A) + ', b = ' + _pp(B), show(Mul(A - B, A + B, evaluate=False)), _same_expr(rest, (A - B) * (A + B))))
        elif deg == 2 and len(t) == 3 and all(c.is_Integer for c in a):
            A_, B_, C_ = a
            if A_ == 1:
                rts = [r_ for r_ in divisors(abs(C_)) if True]
                pair = None
                for p_ in sorted(set([d for d in divisors(abs(C_))] + [-d for d in divisors(abs(C_))])) if C_ != 0 else []:
                    q_ = C_ / p_ if p_ != 0 else None
                    if q_ is not None and q_.is_Integer and p_ + q_ == B_:
                        pair = (p_, q_)
                        break
                if pair:
                    st.append(_st('Find two numbers that multiply to ' + _pp(C_) + ' and add to ' + _pp(B_) + ': ' + _pp(pair[0]) + ' and ' + _pp(pair[1]), _pn(pair[0]) + r' \times ' + _pn(pair[1]) + ' = ' + latex(C_) + r',\quad ' + _pn(pair[0]) + ' + ' + _pn(pair[1]) + ' = ' + latex(B_), True))
                    st.append(_st('Write it as two brackets', show(Mul(v + pair[0], v + pair[1], evaluate=False)), _same_expr(rest, (v + pair[0]) * (v + pair[1]))))
            else:
                ac = A_ * C_
                pair = None
                for p_ in sorted(set(list(divisors(abs(ac))) + [-d for d in divisors(abs(ac))])) if ac != 0 else []:
                    q_ = ac / p_
                    if q_.is_Integer and p_ + q_ == B_:
                        pair = (p_, q_)
                        break
                if pair:
                    p_, q_ = pair
                    st.append(_st('Multiply a·c = ' + _pp(A_) + ' × ' + _pp(C_) + ' = ' + _pp(ac) + '; find two numbers that multiply to ' + _pp(ac) + ' and add to ' + _pp(B_) + ': ' + _pp(p_) + ' and ' + _pp(q_), _pn(p_) + r' \times ' + _pn(q_) + ' = ' + latex(ac) + r',\quad ' + _pn(p_) + ' + ' + _pn(q_) + ' = ' + latex(B_), True))
                    split = Add(A_ * v ** 2, p_ * v, q_ * v, C_, evaluate=False)
                    st.append(_st('Split the middle term', show(split), _same_expr(rest, A_ * v ** 2 + p_ * v + q_ * v + C_)))
                    g1 = gcd(A_ * v ** 2, p_ * v); g2 = gcd(q_ * v, C_)
                    if (q_ < 0 and g2 > 0) or (q_ > 0 and C_ < 0 and g2 > 0 and False):
                        g2 = -g2
                    grouped = Add(Mul(g1, expand((A_ * v ** 2 + p_ * v) / g1), evaluate=False), Mul(g2, expand((q_ * v + C_) / g2), evaluate=False), evaluate=False)
                    st.append(_st('Group in pairs and factor each pair', show(grouped), _same_expr(rest, g1 * expand((A_ * v ** 2 + p_ * v) / g1) + g2 * expand((q_ * v + C_) / g2))))
        elif deg == 3 and len(t) == 2 and a[1] == 0 and a[2] == 0:
            c0 = a[3] / a[0]
            cb = (c0 if c0 > 0 else -c0) ** Rational(1, 3)
            if cb.is_Rational and a[0] == 1:
                if c0 > 0:
                    st.append(_st('Sum of cubes: a³ + b³ = (a + b)(a² − ab + b²) with b = ' + _pp(cb), show(Mul(v + cb, v ** 2 - cb * v + cb ** 2, evaluate=False)), _same_expr(rest, (v + cb) * (v ** 2 - cb * v + cb ** 2))))
                else:
                    st.append(_st('Difference of cubes: a³ − b³ = (a − b)(a² + ab + b²) with b = ' + _pp(cb), show(Mul(v - cb, v ** 2 + cb * v + cb ** 2, evaluate=False)), _same_expr(rest, (v - cb) * (v ** 2 + cb * v + cb ** 2))))
        elif len(t) == 4 and deg == 3:
            p1 = Add(*t[:2]); p2 = Add(*t[2:])
            ordered = sorted(t, key=lambda z: -Poly(z, v).degree())
            p1 = ordered[0] + ordered[1]; p2 = ordered[2] + ordered[3]
            g1 = gcd_terms(p1); g2 = gcd_terms(p2)
            f1 = factor(p1); f2 = factor(p2)
            st.append(_st('Group the terms in pairs and factor each pair', show(Add(f1, f2, evaluate=False)), _same_expr(rest, f1 + f2)))
    final = factor(e)
    if len(st) == 1 or latex(final) != st[-1]['l']:
        st.append(_st('Fully factored' if final != E0 else 'This does not factor further over the rationals', latex(final), _same_expr(final, e), 'Check by expanding: it gives back the original.'))
    return {'steps': st, 'method': 'Factoring', 'verified': {'ok': all(s_['v'] is not False for s_ in st), 'how': 'Each form expanded back to the original'}}

# ----- simplify / expand -----
_TRANSFORMS = [
    ('Expand the brackets', lambda z: expand(z)),
    ('Combine into a single fraction', lambda z: together(z)),
    ('Factor', lambda z: factor(z)),
    ('Cancel the common factors', lambda z: cancel(z)),
    ('Use exponent rules', lambda z: powsimp(z, force=False)),
    ('Use trigonometric identities', lambda z: trigsimp(z)),
    ('Simplify the radicals', lambda z: radsimp(z)),
    ('Simplify', lambda z: simplify(z)),
]

def _simplify_steps(e, op):
    fs0 = _free([e])
    if op == 'simplify' and fs0 and e.is_polynomial(*fs0):
        # A polynomial "simplifies" to its factored form when typed expanded, else to its expanded form.
        if e == expand(e) and factor(e) != e:
            return _factor_steps(e)
        if e != expand(e):
            op = 'expand'
    st = [_st('Start with the expression', latex(e), True)]
    cur = e
    if op == 'expand':
        bins = [p for p in preorder_traversal(e) if isinstance(p, Pow) and isinstance(p.base, Add) and p.exp.is_Integer and p.exp > 1]
        if bins:
            b = bins[0]
            n = int(b.exp)
            if n == 2 and len(b.base.args) == 2:
                A, B = b.base.args
                st.append(_st('Square the bracket: (a + b)² = a² + 2ab + b²', latex(e.subs(b, Add(A ** 2, 2 * A * B, B ** 2, evaluate=False))), _same_expr(e, e.subs(b, A ** 2 + 2 * A * B + B ** 2))))
            elif len(b.base.args) == 2:
                st.append(_st('Use the binomial theorem: (a + b)ⁿ = Σ C(n, k) aⁿ⁻ᵏ bᵏ', latex(e.subs(b, expand(b))), _same_expr(e, e.subs(b, expand(b)))))
        mul = expand(e, power_base=False, power_exp=False, mul=True, multinomial=True)
        final = expand(e)
        if not st[-1]['l'] == latex(final):
            st.append(_st('Multiply out every bracket and collect like terms', latex(final), _same_expr(e, final), 'Multiply each term in one bracket by each term in the other, then add terms with the same power.'))
        return {'steps': st, 'method': 'Expanding', 'verified': {'ok': all(s_['v'] is not False for s_ in st), 'how': 'Each step checked equal to the input'}}
    num, den = fraction(together(e))
    if den.has(*_free([e])) and _free([e]):
        fn, fd = factor(num), factor(den)
        if together(e) != e:
            st.append(_st('Combine into a single fraction', latex(together(e)), _same_expr(e, together(e))))
        if fn != num or fd != den:
            st.append(_st('Factor the top and the bottom', latex(Mul(fn, Pow(fd, -1, evaluate=False), evaluate=False)), _same_expr(e, fn / fd)))
        c = cancel(e)
        g = gcd(num, den)
        if g != 1 and g.has(*_free([e])):
            st.append(_st('Cancel the common factor ' + _pp(factor(g)) + ' (for values where it is not zero)', latex(factor(c)), _same_expr(e, c), 'Dividing the top and the bottom by the same non-zero factor does not change the value.'))
        cur = factor(c) if count_ops(factor(c)) <= count_ops(c) else c
    used = set()
    for _ in range(4):
        best = None
        for name, f in _TRANSFORMS:
            if name in used:
                continue
            try:
                nxt = f(cur)
            except Exception:
                continue
            if nxt != cur and count_ops(nxt) < count_ops(cur):
                best = (name, nxt)
                break
        if not best:
            break
        used.add(best[0])
        st.append(_st(best[0], latex(best[1]), _same_expr(cur, best[1])))
        cur = best[1]
    if len(st) == 1:
        st.append(_st('This is already as simple as it gets', latex(e), True))
    return {'steps': st, 'method': 'Simplifying', 'verified': {'ok': all(s_['v'] is not False for s_ in st), 'how': 'Each step checked equal to the one before'}}

# ----- derivatives, rule by rule -----
_DFN = {
    sin: ('sine', lambda u: cos(u)), cos: ('cosine', lambda u: -sin(u)), tan: ('tangent', lambda u: sec(u) ** 2),
    sec: ('secant', lambda u: sec(u) * tan(u)), csc: ('cosecant', lambda u: -csc(u) * cot(u)), cot: ('cotangent', lambda u: -csc(u) ** 2),
    log: ('natural log', lambda u: 1 / u), exp: ('exponential', lambda u: exp(u)),
    asin: ('arcsine', lambda u: 1 / sqrt(1 - u ** 2)), acos: ('arccosine', lambda u: -1 / sqrt(1 - u ** 2)), atan: ('arctangent', lambda u: 1 / (1 + u ** 2)),
    sinh: ('sinh', lambda u: cosh(u)), cosh: ('cosh', lambda u: sinh(u)), tanh: ('tanh', lambda u: 1 - tanh(u) ** 2),
}

def _dl(e, v):
    return r'\frac{d}{d' + latex(v) + r'}\left[' + latex(e) + r'\right]'

def _dsteps(e, v, st, depth=0):
    """Appends rule steps for d/dv e and returns the derivative (checked against SymPy at every node)."""
    true = diff(e, v)
    def add(reason, rhs, d=None):
        if len(st) < _MAXSTEPS:
            ok = _same_expr(rhs.doit() if hasattr(rhs, 'doit') else rhs, true)
            st.append(_st(reason, _dl(e, v) + ' = ' + latex(rhs), ok, d))
    Dv = lambda u: Derivative(u, v)
    def fin(res):
        if len(st) < _MAXSTEPS:
            st.append(_st('Put the pieces together', _dl(e, v) + ' = ' + latex(res), _same_expr(res, true)))
        return res
    if not e.has(v):
        add('The derivative of a constant is 0', Integer(0))
        return Integer(0)
    if e == v:
        add('The derivative of ' + _pp(v) + ' is 1', Integer(1))
        return Integer(1)
    if isinstance(e, Add):
        parts = e.as_ordered_terms()
        add('Sum rule: differentiate each term separately', Add(*[Dv(p) for p in parts], evaluate=False))
        res = [ _dsteps(p, v, st, depth + 1) for p in parts ]
        return fin(Add(*res))
    if isinstance(e, Mul):
        c, rest = e.as_independent(v, as_Add=False)
        if c != 1:
            add('Constant multiple rule: keep ' + _pp(c) + ' and differentiate the rest', Mul(c, Dv(rest), evaluate=False))
            inner = _dsteps(rest, v, st, depth + 1)
            return fin(c * inner) if rest != v and not (isinstance(rest, Pow) and rest.base == v) else c * inner
        num, den = fraction(e)
        if den.has(v) and num != 1:
            add('Quotient rule: (u/w)′ = (u′w − uw′) / w², with u = ' + _pp(num) + ' and w = ' + _pp(den), (Dv(num) * den - num * Dv(den)) / den ** 2, 'Derivative of the top times the bottom, minus the top times the derivative of the bottom, all over the bottom squared.')
            du = _dsteps(num, v, st, depth + 1)
            dw = _dsteps(den, v, st, depth + 1)
            return fin((du * den - num * dw) / den ** 2)
        fs = e.args
        u = fs[0]; w = Mul(*fs[1:])
        add('Product rule: (uw)′ = u′w + uw′, with u = ' + _pp(u) + ' and w = ' + _pp(w), Add(Mul(Dv(u), w, evaluate=False), Mul(u, Dv(w), evaluate=False), evaluate=False), 'Differentiate one factor at a time while keeping the other one as it is, then add.')
        du = _dsteps(u, v, st, depth + 1)
        dw = _dsteps(w, v, st, depth + 1)
        return fin(du * w + u * dw)
    if isinstance(e, Pow):
        b, n = e.base, e.exp
        if not n.has(v):
            if b == v:
                add('Power rule: d/dx xⁿ = n·xⁿ⁻¹' + (' (a root is a fractional power)' if not n.is_Integer else ''), n * v ** (n - 1))
                return n * v ** (n - 1)
            add('Chain rule with the power rule: n·(inside)ⁿ⁻¹ × (derivative of the inside)', Mul(n * b ** (n - 1), Dv(b), evaluate=False), 'Differentiate the outer power as if the inside were x, then multiply by the derivative of the inside.')
            inner = _dsteps(b, v, st, depth + 1)
            return fin(n * b ** (n - 1) * inner)
        if not b.has(v):
            if n == v:
                add('Exponential rule: d/dx aˣ = aˣ·ln a', e * log(b))
                return e * log(b)
            add('Chain rule with the exponential rule: aᵘ·ln a × u′', Mul(e * log(b), Dv(n), evaluate=False))
            inner = _dsteps(n, v, st, depth + 1)
            return fin(e * log(b) * inner)
        add('Variable base and exponent: write it as e^(' + _pp(n) + '·ln ' + _pp(b) + ') and use the chain rule', diff(e, v))
        return diff(e, v)
    fn = type(e)
    if fn in _DFN and len(e.args) == 1:
        name, d = _DFN[fn]
        u = e.args[0]
        if u == v:
            add('Derivative of the ' + name + ' function', d(v))
            return d(v)
        add('Chain rule: derivative of the outer ' + name + ' function × derivative of the inside (' + _pp(u) + ')', Mul(d(u), Dv(u), evaluate=False), 'Treat the inside as one block, differentiate the outside, then multiply by the derivative of the inside.')
        inner = _dsteps(u, v, st, depth + 1)
        return fin(d(u) * inner)
    if isinstance(e, log) and len(e.args) == 2:
        add('Change of base: log_b(u) = ln u / ln b', diff(e, v))
        return diff(e, v)
    add('Differentiate', true)
    return true

def _steps_diff(req):
    e = _parse(req['exprs'][0], real=True)
    v = _sym(req['vars'][0], True)
    n = req.get('order', 1) or 1
    if len(req.get('vars') or []) > 1:
        return None
    st = [_st('Differentiate with respect to ' + _pp(v), _dl(e, v), True)]
    cur = e
    for k in range(n):
        if n > 1:
            st.append(_st(('First' if k == 0 else 'Second' if k == 1 else 'Next') + ' derivative', _dl(cur, v), True))
        raw = _dsteps(cur, v, st)
        nice = _nice(raw)
        if latex(nice) != latex(raw) and not st[-1]['l'].endswith(' = ' + latex(nice)):
            st.append(_st('Simplify', latex(nice), _same_expr(nice, diff(cur, v))))
        cur = nice
    if req.get('point') is not None:
        p = _parse(req['point'], True)
        val = simplify(cur.subs(v, p))
        st.append(_st('Substitute ' + _pp(v) + ' = ' + _pp(p), latex(cur.subs(v, p)) + ' = ' + latex(val), _same_expr(val, diff(e, v, n).subs(v, p))))
    ok = all(s_['v'] is not False for s_ in st)
    if not ok:
        return {'steps': [st[0], _st('Result (computed by the algebra engine)', latex(_nice(diff(e, v, n))), None)], 'method': 'Direct', 'verified': None}
    return {'steps': st, 'method': 'Differentiation rules', 'verified': {'ok': True, 'how': 'Every rule step checked against SymPy'}}

# ----- integrals, method named -----
def _rname(rule):
    return type(rule).__name__

def _irule_text(rule):
    n = _rname(rule)
    ig = rule.integrand
    v = rule.variable
    if n == 'ConstantRule':
        return 'The integral of a constant c is c·' + _pp(v)
    if n == 'PowerRule':
        return 'Power rule: ∫ xⁿ dx = xⁿ⁺¹ / (n + 1)'
    if n == 'ReciprocalRule':
        return 'The integral of 1/u is ln u (ln|u| when u can be negative)'
    if n == 'ExpRule':
        return 'The integral of aᵘ is aᵘ / ln a (eᵘ stays eᵘ)'
    if n in ('SinRule', 'CosRule', 'SecTanRule', 'CscCotRule', 'Sec2Rule', 'Csc2Rule', 'TanRule', 'CotRule'):
        return 'Standard trigonometric integral'
    if n in ('ArctanRule', 'ArcsinRule', 'ArcsinhRule', 'ArccoshRule', 'InverseHyperbolicRule', 'ReciprocalSqrtQuadraticRule'):
        return 'Standard inverse-trig integral'
    if n in ('SqrtQuadraticRule',):
        return 'Standard integral of a square root of a quadratic (it comes from a trig substitution)'
    if n in ('SinhRule', 'CoshRule'):
        return 'Standard hyperbolic integral'
    return 'Standard integral'

def _iwalk(rule, st, meth):
    if len(st) >= _MAXSTEPS:
        return
    n = _rname(rule)
    ig, v = rule.integrand, rule.variable
    try:
        res = rule.eval()
    except Exception:
        res = None
    lhs = latex(Integral(ig, v))
    ok = _same_expr(diff(res, v), ig) if res is not None else None
    if n == 'AlternativeRule':
        return _iwalk(rule.alternatives[0], st, meth)
    if n == 'AddRule':
        st.append(_st('Integrate term by term', lhs + ' = ' + ' + '.join(latex(Integral(s_.integrand, v)) for s_ in rule.substeps), True))
        for s_ in rule.substeps:
            _iwalk(s_, st, meth)
        st.append(_st('Add the results', lhs + ' = ' + latex(res), ok))
        return
    if n == 'ConstantTimesRule':
        st.append(_st('Move the constant ' + _pp(rule.constant) + ' outside the integral', lhs + ' = ' + latex(rule.constant) + latex(Integral(rule.other, v)), True))
        _iwalk(rule.substep, st, meth)
        if _rname(rule.substep) not in ('PowerRule', 'ConstantRule', 'ExpRule', 'ReciprocalRule', 'SinRule', 'CosRule'):
            st.append(_st('Multiply by ' + _pp(rule.constant), lhs + ' = ' + latex(res), ok))
        return
    if n == 'URule':
        meth.append('Substitution')
        u = rule.u_var
        st.append(_st('Substitute u = ' + _pp(rule.u_func) + ', so du = ' + _pp(diff(rule.u_func, v)) + ' d' + _pp(v), r'u = ' + latex(rule.u_func) + r',\quad du = ' + latex(diff(rule.u_func, v)) + r'\,d' + latex(v), True, 'Pick the inside of a composition whose derivative also appears; the integral becomes simpler in u.'))
        sub = rule.substep
        st.append(_st('Rewrite the integral in terms of u', lhs + ' = ' + latex(Integral(sub.integrand, u)), _same_expr(sub.integrand.subs(u, rule.u_func) * diff(rule.u_func, v), ig)))
        _iwalk(sub, st, meth)
        st.append(_st('Substitute back u = ' + _pp(rule.u_func), lhs + ' = ' + latex(res), ok))
        return
    if n == 'PartsRule':
        meth.append('Integration by parts')
        st.append(_st('Integration by parts: ∫u dv = uv − ∫v du, with u = ' + _pp(rule.u) + ' and dv = ' + _pp(rule.dv) + ' d' + _pp(v), r'u = ' + latex(rule.u) + r',\; dv = ' + latex(rule.dv) + r'\,d' + latex(v) + r',\; du = ' + latex(diff(rule.u, v)) + r'\,d' + latex(v) + r',\; v = ' + latex(rule.v_step.eval()), True, 'Choose u to be something that gets simpler when differentiated (LIATE: logs, inverse trig, algebraic, trig, exponential).'))
        vv = rule.v_step.eval()
        rest = Integral(expand(vv * diff(rule.u, v)), v)
        st.append(_st('Apply the formula', lhs + ' = ' + latex(rule.u * vv) + ' - ' + latex(rest), True))
        if rule.second_step is not None:
            _iwalk(rule.second_step, st, meth)
        st.append(_st('Put it together', lhs + ' = ' + latex(res), ok))
        return
    if n == 'CyclicPartsRule':
        meth.append('Integration by parts')
        st.append(_st('Integrate by parts twice; the original integral comes back, so solve for it', lhs + ' = ' + latex(res), ok, 'Call the integral I. After two rounds of parts you get I = (something) − k·I, so I = (something)/(1 + k).'))
        return
    if n == 'TrigSubstitutionRule':
        meth.append('Trigonometric substitution')
        th = rule.theta
        st.append(_st('Trig substitution: let ' + _pp(v) + ' = ' + _pp(rule.func), latex(v) + ' = ' + latex(rule.func) + r',\quad d' + latex(v) + ' = ' + latex(diff(rule.func, th)) + r'\,d' + latex(th), True, 'A square root of a² − x², a² + x² or x² − a² simplifies with sin, tan or sec using a Pythagorean identity.'))
        st.append(_st('Rewrite and simplify with a Pythagorean identity', lhs + ' = ' + latex(Integral(rule.rewritten, th)), None))
        _iwalk(rule.substep, st, meth)
        st.append(_st('Change back to ' + _pp(v), lhs + ' = ' + latex(res), ok))
        return
    if n == 'RewriteRule':
        rw = rule.rewritten
        pf = False
        try:
            pf = ig.is_rational_function(v) and _same_expr(rw, apart(ig, v)) and len(Add.make_args(rw)) > 1 and fraction(together(ig))[1].has(v)
        except Exception:
            pf = False
        if pf:
            meth.append('Partial fractions')
            st.append(_st('Split into partial fractions', lhs + ' = ' + latex(Integral(rw, v)), _same_expr(rw, ig), 'Factor the denominator and write the fraction as a sum of simpler fractions, one per factor.'))
        else:
            st.append(_st('Rewrite the integrand', lhs + ' = ' + latex(Integral(rw, v)), _same_expr(rw, ig)))
        _iwalk(rule.substep, st, meth)
        return
    if n == 'DontKnowRule':
        raise ValueError('no manual method')
    st.append(_st(_irule_text(rule), lhs + ' = ' + latex(res), ok))

def _steps_integrate(req):
    e = _parse(req['exprs'][0], real=True)
    v = _sym(req['vars'][0], True)
    st = [_st('Find the integral', latex(Integral(e, v) if req.get('lower') is None else Integral(e, (v, _parse(req['lower'], True), _parse(req['upper'], True)))), True)]
    meth = []
    # Partial fractions are named explicitly when the integrand is a proper or improper rational function.
    try:
        if e.is_rational_function(v) and fraction(together(e))[1].has(v):
            ap = apart(e, v)
            if len(Add.make_args(ap)) > 1 and ap != e:
                meth.append('Partial fractions')
                st.append(_st('Split into partial fractions', latex(Integral(e, v)) + ' = ' + latex(Integral(ap, v)), _same_expr(ap, e), 'Factor the denominator and write the fraction as a sum of simpler fractions, one per factor.'))
                e_work = ap
            else:
                e_work = e
        else:
            e_work = e
        rule = _integral_steps(e_work, v)
        _iwalk(rule, st, meth)
        F = rule.eval()
    except Exception:
        return None
    if not _same_expr(diff(F, v), e):
        return None
    nice = _nice(F)
    if latex(nice) != latex(F) and _same_expr(diff(nice, v), e):
        st.append(_st('Simplify', latex(nice), True))
        F = nice
    if req.get('lower') is not None:
        a = _parse(req['lower'], True); b = _parse(req['upper'], True)
        Fb, Fa = F.subs(v, b), F.subs(v, a)
        val = simplify(Fb - Fa)
        st.append(_st('Evaluate F(' + _pp(b) + ') − F(' + _pp(a) + ')', r'\left[' + latex(F) + r'\right]_{' + latex(a) + '}^{' + latex(b) + '} = ' + latex(simplify(Fb)) + ' - ' + r'\left(' + latex(simplify(Fa)) + r'\right) = ' + latex(val), _same_expr(val, integrate(e, (v, a, b)))))
    else:
        Fa = _abs_logs(F, e, v)
        if Fa != F:
            st.append(_st('Write ln|u| so the answer also holds where u < 0', latex(Fa), _same_expr(diff(Fa, v), e), 'd/dx ln|u| = u′/u for u of either sign.'))
            F = Fa
        st.append(_st('Add the constant of integration', latex(F) + ' + C', _same_expr(diff(F, v), e), 'Any constant differentiates to 0, so every antiderivative differs by a constant C.'))
        try:
            main = _abs_logs(integrate(e, v), e, v)
            if not main.has(Integral) and not _same_expr(main, F):
                st.append(_st('This matches the answer above up to a constant', latex(simplify(F - main)) + r' = \text{constant}', _zero_check(diff(F - main, v))))
        except Exception:
            pass
    ok = all(s_['v'] is not False for s_ in st)
    if not ok:
        return None
    m = meth[0] if meth else 'Basic rules'
    return {'steps': st, 'method': m, 'verified': {'ok': True, 'how': 'Differentiated back to the integrand'}}

# ----- limits -----
def _steps_limit(req):
    e = _parse(req['exprs'][0], real=True)
    v = _sym(req['vars'][0], True)
    p = _parse(req['point'], True) if req.get('point') not in ('oo', '-oo') else (oo if req['point'] == 'oo' else -oo)
    dir_ = req.get('dir')
    lim_tex = lambda z, d=None: r'\lim_{' + latex(v) + r' \to ' + latex(p) + ('^{' + (d or dir_) + '}' if (d or dir_) else '') + '} ' + latex(z)
    st = [_st('Find the limit', lim_tex(e), True)]
    if dir_ or not p.is_finite:
        L = limit(e, v, p, dir_) if dir_ else limit(e, v, p)
    else:
        # Two-sided: SymPy's limit() alone approaches from the right only, which would contradict the answer (1/x at 0).
        Ll = limit(e, v, p, '-'); Lr = limit(e, v, p, '+')
        if Ll != Lr:
            st.append(_st('Approach ' + _pp(p) + ' from the left', lim_tex(e, '-') + ' = ' + latex(Ll), True))
            st.append(_st('Approach ' + _pp(p) + ' from the right', lim_tex(e, '+') + ' = ' + latex(Lr), True))
            st.append(_st('The one-sided limits differ, so the limit does not exist', lim_tex(e) + r' \text{ does not exist}', True, 'A two-sided limit exists only when the left and right limits are equal.'))
            return {'steps': st, 'method': 'One-sided limits', 'verified': {'ok': True, 'how': 'Both one-sided limits computed with SymPy'}}
        L = Lr
    def chk(z):
        try:
            return _same_expr(limit(z, v, p, dir_) if dir_ else limit(z, v, p), L)
        except Exception:
            return None
    cur = e
    if p.is_finite:
        try:
            val = cur.subs(v, p)
            direct = val.is_finite and not val.has(nan, zoo)
        except Exception:
            direct = False
        if direct:
            st.append(_st('Substitute ' + _pp(v) + ' = ' + _pp(p) + ' directly (the function is continuous there)', lim_tex(cur) + ' = ' + latex(simplify(val)), _same_expr(simplify(val), L)))
            return {'steps': st, 'method': 'Direct substitution', 'verified': {'ok': True, 'how': 'Compared with SymPy limit'}}
    for _round in range(4):
        num, den = fraction(together(cur))
        try:
            nl = limit(num, v, p, dir_) if dir_ else limit(num, v, p)
            dl_ = limit(den, v, p, dir_) if dir_ else limit(den, v, p)
        except Exception:
            break
        zero_zero = nl == 0 and dl_ == 0
        inf_inf = nl in (oo, -oo) and dl_ in (oo, -oo)
        if not (zero_zero or inf_inf):
            break
        form = '0/0' if zero_zero else '∞/∞'
        if num.is_polynomial(v) and den.is_polynomial(v) and p.is_finite:
            c = cancel(cur)
            fn, fd = factor(num), factor(den)
            st.append(_st('Substituting gives ' + form + ', so factor the top and bottom', lim_tex(Mul(fn, Pow(fd, -1, evaluate=False), evaluate=False)), chk(fn / fd)))
            st.append(_st('Cancel the common factor', lim_tex(c), chk(c)))
            cur = c
            continue
        if num.is_polynomial(v) and den.is_polynomial(v) and not p.is_finite:
            k = max(Poly(num, v).degree(), Poly(den, v).degree())
            nn = expand(num / v ** k); dd = expand(den / v ** k)
            st.append(_st('Divide the top and bottom by the highest power, ' + _pp(v ** k), lim_tex(Mul(nn, Pow(dd, -1, evaluate=False), evaluate=False)), chk(nn / dd)))
            st.append(_st('Terms like 1/' + _pp(v) + ' go to 0 as ' + _pp(v) + ' → ' + _pp(p), lim_tex(cur) + ' = ' + latex(L), True))
            return {'steps': st, 'method': 'Highest power', 'verified': {'ok': all(s_['v'] is not False for s_ in st), 'how': 'Each step compared with SymPy limit'}}
        dn, dd = diff(num, v), diff(den, v)
        nxt = dn / dd
        st.append(_st('Substituting gives ' + form + ', so use L\'Hôpital\'s rule: differentiate the top and the bottom', lim_tex(Mul(dn, Pow(dd, -1, evaluate=False), evaluate=False)), chk(nxt), 'If f/g gives 0/0 or ∞/∞, the limit of f/g equals the limit of f′/g′ (when that exists).'))
        cur = nxt
        try:
            val = simplify(cur.subs(v, p)) if p.is_finite else None
            if val is not None and val.is_finite and not val.has(nan, zoo):
                st.append(_st('Now substitute ' + _pp(v) + ' = ' + _pp(p), lim_tex(cur) + ' = ' + latex(val), _same_expr(val, L)))
                return {'steps': st, 'method': "L'Hôpital's rule", 'verified': {'ok': all(s_['v'] is not False for s_ in st), 'how': 'Each step compared with SymPy limit'}}
        except Exception:
            pass
    try:
        if p.is_finite:
            val = simplify(cur.subs(v, p))
            if val.is_finite and not val.has(nan, zoo) and cur != e:
                st.append(_st('Substitute ' + _pp(v) + ' = ' + _pp(p), lim_tex(cur) + ' = ' + latex(val), _same_expr(val, L)))
                return {'steps': st, 'method': 'Factor and cancel' if not any("L'H" in s_['r'] for s_ in st) else "L'Hôpital's rule", 'verified': {'ok': all(s_['v'] is not False for s_ in st), 'how': 'Each step compared with SymPy limit'}}
    except Exception:
        pass
    st.append(_st('Evaluate the limit (algebra engine)', lim_tex(cur) + ' = ' + latex(L), None))
    return {'steps': st, 'method': 'Limit', 'verified': None}

def _steps(req):
    task = req.get('task') or 'solve'
    sub = dict(req)
    sub['op'] = task
    out = None
    if task == 'solve':
        out = _steps_solve(sub)
    elif task == 'diff':
        out = _steps_diff(sub)
    elif task == 'integrate':
        out = _steps_integrate(sub)
    elif task == 'limit':
        out = _steps_limit(sub)
    elif task == 'factor':
        out = _factor_steps(_parse(req['exprs'][0]))
    elif task in ('simplify', 'expand'):
        out = _simplify_steps(_parse(req['exprs'][0]), task)
    elif task == 'matrix':
        out = _steps_matrix(sub)
    if not out:
        return {'steps': [], 'method': None, 'text': '', 'none': True}
    if len(out.get('steps', [])) > _MAXSTEPS + 6:
        out['steps'] = out['steps'][:_MAXSTEPS] + [_st('… (more steps omitted)', r'\cdots', None)]
    out['text'] = out.get('method') or ''
    for s_ in out['steps'] + [x for a in out.get('alt', []) for x in a['steps']]:
        s_['l'] = _logtex(s_['l'])
    return out

_LOGB = _re.compile(r'\\frac\{\\log\{\\left\(([^{}]*?) \\right\)\}\}\{\\log\{\\left\((\d+) \\right\)\}\}')
def _logtex(t):
    t = _LOGB.sub(lambda m: r'\log_{' + m.group(2) + r'}{\left(' + m.group(1) + r' \right)}', t)
    return t.replace(r'\log{', r'\ln{')

# ---------- the full report (op 'report') ----------
def _report(req):
    out = _report_inner(req)
    if req.get('what') != 'intervals':
        try:
            e0 = _parse(req['exprs'][0], real=True)
            out['plain'] = _plain(e0)
            out['latex_out'] = _logtex(latex(e0))
        except Exception:
            pass
    return out

def _fundamental_period(e, v):
    """The smallest positive period, checked. SymPy's periodicity() returns a period, not always the fundamental one
    (sin(x)**2 gives 2π; the answer is π), and the check rejects anything that isn't a period at all."""
    per = _periodicity(e, v)
    if per is None or per == 0:
        return None
    per = abs(per)
    if not _zero_check(e.subs(v, v + per) - e):
        return None
    for k in range(12, 1, -1):
        cand = per / k
        if _zero_check(e.subs(v, v + cand) - e):
            return cand
    return per

def _report_inner(req):
    what = req.get('what')
    e = _parse(req['exprs'][0], real=True)
    fs = _free([e])
    v = _sym(req['vars'][0], True) if req.get('vars') else (fs[0] if fs else Symbol('x', real=True))
    items = []
    if what == 'alt':
        seen = {latex(e)}
        for name, f in (('Simplified', simplify), ('Expanded', expand), ('Factored', factor), ('Single fraction', together), ('Partial fractions', lambda z: apart(z, v) if z.is_rational_function(v) else z), ('Trig form', trigsimp)):
            try:
                z = f(e)
            except Exception:
                continue
            t = latex(z)
            if t not in seen and count_ops(z) < 80:
                seen.add(t)
                items.append([name, t, _pp(z)])
        return {'items': items[:5]}
    if what == 'roots':
        s = solveset(e, v, S.Reals)
        if _fin(s):
            rs = sorted(s, key=lambda z: N(z))[:12]
            items = [[latex(v) + ' = ' + latex(r_), latex(r_), _num(r_) or _pp(r_)] for r_ in rs]
            return {'items': items, 'none': not rs}
        if e.is_polynomial(v):
            rs = [re(r_) for r_ in Poly(e, v).nroots(n=12) if abs(im(r_)) < 1e-12]
            return {'items': [[latex(v) + r' \approx ' + _num(r_), latex(r_), _num(r_)] for r_ in rs], 'none': not rs}
        return {'items': [['Roots', latex(s), _pp(s)]] if s != S.EmptySet else [], 'none': s == S.EmptySet}
    if what == 'domain':
        dom = _cdomain(e, v, S.Reals)
        out = {'items': [['Domain', latex(dom), _pp(dom)]]}
        try:
            rg = _frange(e, v, dom)
            out['items'].append(['Range', latex(rg), _pp(rg)])
        except Exception:
            pass
        return out
    if what == 'deriv':
        d = _nice(diff(e, v))
        return {'items': [[r'\frac{d}{d' + latex(v) + '}', latex(d), _pp(d)]]}
    if what == 'integral':
        if count_ops(e) > 40:
            return {'items': []}
        F = integrate(e, v)
        if F.has(Integral):
            return {'items': [], 'note': 'No elementary antiderivative'}
        F = _nice(F) if count_ops(F) < 60 else F
        return {'items': [[r'\int', latex(F) + ' + C', _pp(F) + ' + C']]}
    if what == 'series':
        try:
            s_ = series(e, v, 0, 6).removeO()
            if s_ == e:
                return {'items': []}
            return {'items': [['At ' + _pp(v) + ' = 0', latex(s_) + r' + O(' + latex(v ** 6) + ')', _pp(s_)]]}
        except Exception:
            return {'items': []}
    if what == 'limits':
        for pt, nm in ((oo, '∞'), (-oo, '−∞')):
            try:
                L = limit(e, v, pt)
                if isinstance(L, AccumBounds):
                    items.append([_pp(v) + ' → ' + nm, r'\text{no limit (oscillates between ' + _pp(L.min) + ' and ' + _pp(L.max) + ')}', 'no limit (oscillates between ' + _pp(L.min) + ' and ' + _pp(L.max) + ')'])
                elif L.has(AccumBounds) or L.has(Limit) or L.has(nan) or L.has(zoo):
                    # SymPy's raw forms ("∞·sign(AccumBounds(−1, 1))", an unevaluated Limit) are not answers: say what they mean.
                    items.append([_pp(v) + ' → ' + nm, r'\text{no limit (oscillates without bound)}' if L.has(AccumBounds) else r'\text{undetermined}', 'no limit (oscillates without bound)' if L.has(AccumBounds) else 'undetermined'])
                else:
                    items.append([_pp(v) + ' → ' + nm, latex(L), _pp(L)])
            except Exception:
                pass
        return {'items': items}
    if what == 'props':
        try:
            ev = _zero_check(e.subs(v, -v) - e)
            od = (not ev) and _zero_check(e.subs(v, -v) + e)
            items.append(['Symmetry', r'\text{even}' if ev else r'\text{odd}' if od else r'\text{neither even nor odd}', 'even' if ev else 'odd' if od else 'neither even nor odd'])
        except Exception:
            pass
        try:
            per = _fundamental_period(e, v)
            if per is not None:
                items.append(['Period', latex(per), _pp(per)])
        except Exception:
            pass
        try:
            d = diff(e, v)
            crit = solveset(d, v, S.Reals)
            dom = _cdomain(e, v, S.Reals)
            if _fin(crit) and len(crit) <= 8 and dom == S.Reals:
                pts = sorted(crit, key=lambda z: N(z))
                edges = [-oo] + pts + [oo]
                inc, dec = [], []
                for i in range(len(edges) - 1):
                    a, b = edges[i], edges[i + 1]
                    t = (b - 1) if a == -oo and b != oo else (a + 1) if b == oo and a != -oo else Integer(0) if a == -oo else (a + b) / 2
                    sv = N(d.subs(v, t))
                    iv = Interval.open(a, b)
                    (inc if sv > 0 else dec if sv < 0 else []).append(iv)
                if inc:
                    items.append(['Increasing on', latex(Union(*inc)), _pp(Union(*inc))])
                if dec:
                    items.append(['Decreasing on', latex(Union(*dec)), _pp(Union(*dec))])
                if pts:
                    items.append(['Critical points', ', '.join(latex(v) + ' = ' + latex(p_) for p_ in pts), ', '.join(_pp(p_) for p_ in pts)])
        except Exception:
            pass
        return {'items': items}
    if what == 'intervals':
        rel = (req.get('rels') or ['='])[0]
        l, r = _sides(req, 0)
        v2 = _sym(req['vars'][0], True) if req.get('vars') else (_free([l, r])[0])
        sol = solveset(_rel(l, r, rel), v2, S.Reals)
        return {'intervals': _interval_list(sol), 'items': [['Solution set', latex(sol), _pp(sol)]]}
    raise ValueError('Unknown report section')
`;
