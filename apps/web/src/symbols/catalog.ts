import { UNICODE_BLOCKS, UNICODE_COUNT } from './unicode';

/**
 * The symbol catalog: hand-picked categories (with everyday names, aliases and LaTeX commands) first, then every
 * math-related Unicode character by block (unicode.ts, generated). Loaded only with the symbol menu.
 */

export interface Sym {
  /** What gets inserted. */
  text: string;
  /** Readable name ("not equal to"). */
  name: string;
  /** Other words people search for. */
  aliases: string[];
  /** LaTeX commands, with the backslash. */
  tex: string[];
  /** How it is drawn on its key, when that differs from `text` (combining marks get a dotted circle). */
  show?: string;
}

export interface Category {
  id: string;
  label: string;
  items: Sym[];
}

/** One entry per line: text | name; alias; alias | \tex \tex | shown-as */
function parse(src: string): Sym[] {
  const out: Sym[] = [];
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const [text, names = '', tex = '', show] = line.split(' | ').map((s) => s.trim());
    const [name = text!, ...aliases] = names.split(';').map((s) => s.trim()).filter(Boolean);
    out.push({ text: text!, name, aliases, tex: tex.split(' ').filter(Boolean), ...(show ? { show } : {}) });
  }
  return out;
}

const GREEK = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega'.split(' ');
const NO_TEX_UPPER = new Set(['alpha', 'beta', 'epsilon', 'zeta', 'eta', 'iota', 'kappa', 'mu', 'nu', 'omicron', 'rho', 'tau', 'chi']);
const GREEK_MEANING: Record<string, string> = {
  pi: 'circle constant; 3.14159', theta: 'angle', lambda: 'wavelength', mu: 'micro; mean', sigma: 'standard deviation', delta: 'change; small amount',
  omega: 'angular velocity; ohm', phi: 'golden ratio; angle', rho: 'density', tau: 'two pi; torque', epsilon: 'small number', alpha: 'angle; significance',
};

function greek(): Sym[] {
  const lower: Sym[] = [];
  const upper: Sym[] = [];
  GREEK.forEach((g, i) => {
    // Capital sigma's slot (U+03A2) is empty: letters after rho shift by one.
    const offset = i >= 17 ? i + 1 : i;
    const extra = GREEK_MEANING[g]?.split('; ') ?? [];
    lower.push({ text: String.fromCodePoint(0x3b1 + offset), name: g, aliases: ['greek', ...extra], tex: g === 'omicron' ? [] : [`\\${g}`] });
    const cap = g[0]!.toUpperCase() + g.slice(1);
    upper.push({ text: String.fromCodePoint(0x391 + offset), name: `capital ${g}`, aliases: ['greek', 'upper', cap], tex: NO_TEX_UPPER.has(g) ? [] : [`\\${cap}`] });
  });
  const variants = parse(String.raw`
    ς | final sigma; greek; varsigma | \varsigma
    ϵ | lunate epsilon; greek; epsilon variant | \epsilon
    ε | epsilon variant; greek | \varepsilon
    ϑ | theta variant; greek; script theta | \vartheta
    ϕ | phi variant; greek; straight phi | \phi
    ϰ | kappa variant; greek | \varkappa
    ϖ | pi variant; greek; omega pi | \varpi
    ϱ | rho variant; greek | \varrho
    ϝ | digamma; greek | \digamma
  `);
  return [...lower, ...variants, ...upper];
}

const CURATED: [id: string, label: string, src: string | (() => Sym[])][] = [
  ['greek', 'Greek', greek],
  ['operators', 'Operators', String.raw`
    + | plus; add
    − | minus; subtract; minus sign
    × | times; multiply; multiplication | \times
    ÷ | divide; division; obelus | \div
    · | dot; middle dot; product | \cdot
    ± | plus or minus; plus minus | \pm
    ∓ | minus or plus | \mp
    ∘ | ring; compose; composition | \circ
    √ | square root; root; radical | \sqrt \surd
    ∛ | cube root | \sqrt[3]
    ∜ | fourth root | \sqrt[4]
    ∑ | sum; summation; sigma | \sum
    ∏ | product; pi product | \prod
    ∐ | coproduct | \coprod
    ∫ | integral | \int
    ∬ | double integral | \iint
    ∭ | triple integral | \iiint
    ∮ | contour integral; line integral | \oint
    ∯ | surface integral | \oiint
    ∂ | partial; partial derivative; del | \partial
    ∇ | nabla; del; gradient | \nabla
    ∆ | increment; delta; change | \Delta
    ⋅ | dot operator; dot product | \cdot
    ∗ | asterisk; convolution | \ast
    ⊕ | circled plus; xor; direct sum | \oplus
    ⊖ | circled minus | \ominus
    ⊗ | circled times; tensor product | \otimes
    ⊘ | circled slash | \oslash
    ⊙ | circled dot | \odot
    ∖ | set minus; backslash | \setminus
    ⋆ | star | \star
    ‰ | per mille; per thousand
    ! | factorial
    % | percent
    ^ | power; exponent; caret
    ∣ | divides | \mid
    ∤ | does not divide | \nmid
  `],
  ['relations', 'Relations', String.raw`
    = | equals; equal
    ≠ | not equal to; unequal; not equal | \neq \ne
    ≈ | approximately equal; almost equal | \approx
    ≉ | not approximately equal | \not\approx
    ≡ | identical to; congruent; equivalent | \equiv
    ≢ | not identical to | \not\equiv
    ≅ | congruent; isomorphic | \cong
    ≃ | asymptotically equal | \simeq
    ∼ | similar; tilde | \sim
    ∝ | proportional to | \propto
    < | less than | \lt
    > | greater than | \gt
    ≤ | less than or equal to; at most | \leq \le
    ≥ | greater than or equal to; at least | \geq \ge
    ≦ | less than over equal | \leqq
    ≧ | greater than over equal | \geqq
    ≪ | much less than | \ll
    ≫ | much greater than | \gg
    ≺ | precedes | \prec
    ≻ | succeeds | \succ
    ≐ | approaches the limit | \doteq
    ≜ | defined as; delta equal | \triangleq
    ≝ | equal by definition | \stackrel{def}{=}
    ≟ | questioned equal to
    ≲ | less than or similar | \lesssim
    ≳ | greater than or similar | \gtrsim
    ⊢ | proves; turnstile | \vdash
    ⊨ | models; entails | \models
  `],
  ['sets', 'Sets & logic', String.raw`
    ∈ | element of; in; belongs to | \in
    ∉ | not an element of; not in | \notin
    ∋ | contains as member | \ni
    ⊂ | subset; subset of; proper subset | \subset
    ⊆ | subset of or equal to; subset or equal | \subseteq
    ⊃ | superset of | \supset
    ⊇ | superset of or equal to | \supseteq
    ⊄ | not a subset of | \not\subset
    ⊊ | subset not equal | \subsetneq
    ∪ | union; cup | \cup
    ∩ | intersection; cap | \cap
    ⋃ | big union | \bigcup
    ⋂ | big intersection | \bigcap
    ∅ | empty set; null set | \emptyset \varnothing
    ℕ | natural numbers | \mathbb{N}
    ℤ | integers | \mathbb{Z}
    ℚ | rational numbers | \mathbb{Q}
    ℝ | real numbers; reals | \mathbb{R}
    ℂ | complex numbers | \mathbb{C}
    ℙ | primes; probability | \mathbb{P}
    ∀ | for all; every | \forall
    ∃ | there exists; exists | \exists
    ∄ | there does not exist | \nexists
    ¬ | not; negation | \neg \lnot
    ∧ | and; logical and; wedge | \wedge \land
    ∨ | or; logical or; vee | \vee \lor
    ⇒ | implies; therefore arrow | \Rightarrow \implies
    ⇔ | if and only if; iff; equivalent | \Leftrightarrow \iff
    ⊕ | exclusive or; xor | \oplus
    ⊤ | true; top | \top
    ⊥ | false; bottom; perpendicular | \bot \perp
    ∴ | therefore | \therefore
    ∵ | because; since | \because
    ∎ | end of proof; qed; tombstone | \blacksquare \qed
    ℵ | aleph; cardinality | \aleph
    ⊎ | multiset union | \uplus
  `],
  ['arrows', 'Arrows', String.raw`
    → | right arrow; to; maps to; tends to | \to \rightarrow
    ← | left arrow; gets | \leftarrow \gets
    ↑ | up arrow | \uparrow
    ↓ | down arrow | \downarrow
    ↔ | left right arrow | \leftrightarrow
    ↕ | up down arrow | \updownarrow
    ⇒ | double right arrow; implies | \Rightarrow
    ⇐ | double left arrow; implied by | \Leftarrow
    ⇔ | double left right arrow; iff | \Leftrightarrow
    ⇑ | double up arrow | \Uparrow
    ⇓ | double down arrow | \Downarrow
    ↦ | maps to; mapsto | \mapsto
    ↪ | hook right arrow; injection | \hookrightarrow
    ⟶ | long right arrow | \longrightarrow
    ⟵ | long left arrow | \longleftarrow
    ⟷ | long left right arrow | \longleftrightarrow
    ⟹ | long implies | \Longrightarrow
    ⟺ | long iff | \Longleftrightarrow
    ↗ | north east arrow; increasing | \nearrow
    ↘ | south east arrow; decreasing | \searrow
    ↙ | south west arrow | \swarrow
    ↖ | north west arrow | \nwarrow
    ⇌ | equilibrium; right left harpoons | \rightleftharpoons
    ⇀ | right harpoon | \rightharpoonup
    ↻ | clockwise | \circlearrowright
    ↺ | anticlockwise; counterclockwise | \circlearrowleft
  `],
  ['calculus', 'Calculus', String.raw`
    ∞ | infinity; infinite | \infty
    lim  | limit | \lim | lim
    d/dx | derivative; d by dx | \frac{d}{dx}
    dy/dx | derivative of y | \frac{dy}{dx}
    ∂/∂x | partial derivative | \frac{\partial}{\partial x}
    ∫ | integral | \int
    dx | dx; with respect to x
    ′ | prime; derivative; minutes; feet | \prime
    ″ | double prime; second derivative; seconds; inches | \prime\prime
    ‴ | triple prime
    ∂ | partial | \partial
    ∇ | gradient; nabla | \nabla
    ∑ | sum | \sum
    ∏ | product | \prod
    ∮ | contour integral | \oint
    ε | epsilon; small | \varepsilon
    δ | delta; small change | \delta
    ∆ | change; increment | \Delta
    → | approaches; tends to | \to
  `],
  ['scripts', 'Super & subscripts', String.raw`
    ⁰ | superscript zero; power 0
    ¹ | superscript one; power 1
    ² | superscript two; squared; power 2
    ³ | superscript three; cubed; power 3
    ⁴ | superscript four
    ⁵ | superscript five
    ⁶ | superscript six
    ⁷ | superscript seven
    ⁸ | superscript eight
    ⁹ | superscript nine
    ⁺ | superscript plus
    ⁻ | superscript minus; inverse
    ⁼ | superscript equals
    ⁽ | superscript left parenthesis
    ⁾ | superscript right parenthesis
    ⁿ | superscript n; power n
    ⁱ | superscript i
    ₀ | subscript zero
    ₁ | subscript one
    ₂ | subscript two
    ₃ | subscript three
    ₄ | subscript four
    ₅ | subscript five
    ₆ | subscript six
    ₇ | subscript seven
    ₈ | subscript eight
    ₉ | subscript nine
    ₊ | subscript plus
    ₋ | subscript minus
    ₌ | subscript equals
    ₍ | subscript left parenthesis
    ₎ | subscript right parenthesis
    ₐ | subscript a
    ₑ | subscript e
    ₓ | subscript x
    ₙ | subscript n
    ᵢ | subscript i
    ⱼ | subscript j
    ₖ | subscript k
    ₘ | subscript m
    ₜ | subscript t
  `],
  ['fractions', 'Fractions', String.raw`
    ½ | one half; half | \frac{1}{2}
    ⅓ | one third; third | \frac{1}{3}
    ⅔ | two thirds | \frac{2}{3}
    ¼ | one quarter; quarter | \frac{1}{4}
    ¾ | three quarters | \frac{3}{4}
    ⅕ | one fifth | \frac{1}{5}
    ⅖ | two fifths
    ⅗ | three fifths
    ⅘ | four fifths
    ⅙ | one sixth
    ⅚ | five sixths
    ⅐ | one seventh
    ⅛ | one eighth | \frac{1}{8}
    ⅜ | three eighths
    ⅝ | five eighths
    ⅞ | seven eighths
    ⅑ | one ninth
    ⅒ | one tenth
    ⅟ | fraction numerator one
    ⁄ | fraction slash
  `],
  ['geometry', 'Geometry', String.raw`
    ° | degree; degrees | \degree ^\circ
    ∠ | angle | \angle
    ∡ | measured angle | \measuredangle
    ∢ | spherical angle | \sphericalangle
    ⊥ | perpendicular | \perp
    ∥ | parallel | \parallel
    ∦ | not parallel | \nparallel
    △ | triangle | \triangle
    ▲ | filled triangle | \blacktriangle
    □ | square | \square
    ▭ | rectangle
    ○ | circle | \bigcirc
    ⌒ | arc | \frown
    ≅ | congruent | \cong
    ∼ | similar | \sim
    ⌀ | diameter
    ′ | arcminute; prime | \prime
    ″ | arcsecond
    ⟂ | perpendicular (math) | \perp
    ∟ | right angle
    ⊾ | right angle with arc
  `],
  ['units', 'Units & physics', String.raw`
    Ω | ohm; omega; resistance | \Omega
    μ | micro; mu | \mu
    Å | angstrom | \AA
    ℏ | h bar; reduced planck constant | \hbar
    ℎ | planck constant
    ℓ | script l; litre; length | \ell
    ℃ | degree celsius; celsius
    ℉ | degree fahrenheit; fahrenheit
    K | kelvin
    ° | degree | \degree
    λ | wavelength; lambda | \lambda
    ν | frequency; nu | \nu
    ε₀ | vacuum permittivity; epsilon naught
    μ₀ | vacuum permeability; mu naught
    ∝ | proportional to | \propto
    ⊗ | tensor product | \otimes
    ⟨ | left angle bracket; bra | \langle
    ⟩ | right angle bracket; ket | \rangle
    ‖ | norm; double bar | \|
    ⌈ | left ceiling | \lceil
    ⌉ | right ceiling | \rceil
    ⌊ | left floor | \lfloor
    ⌋ | right floor | \rfloor
  `],
  ['currency', 'Currency', String.raw`
    $ | dollar | \$
    ¢ | cent
    € | euro
    £ | pound; sterling
    ¥ | yen; yuan
    ₹ | rupee
    ₩ | won
    ₽ | ruble
    ₪ | shekel
    ₺ | lira
    ₫ | dong
    ₦ | naira
    ₱ | peso
    ₴ | hryvnia
    ₿ | bitcoin
    ฿ | baht
    ₣ | franc
    ₡ | colon
    ₵ | cedi
    ₸ | tenge
  `],
  ['accents', 'Accents', String.raw`
    ̄ | bar; macron; mean; x bar | \bar \overline | x̄
    ̂ | hat; circumflex; unit vector; estimate | \hat | x̂
    ⃗ | vector arrow; vector | \vec | x⃗
    ̇ | dot; time derivative | \dot | ẋ
    ̈ | double dot; second time derivative | \ddot | ẍ
    ̃ | tilde | \tilde | x̃
    ̌ | check; caron | \check | x̌
    ̲ | underline | \underline | x̲
    ⃡ | left right arrow above; line | \overleftrightarrow | x⃡
    ̊ | ring above | \mathring | x̊
    ́ | acute | \acute | x́
    ̀ | grave | \grave | x̀
  `],
  ['misc', 'More', String.raw`
    ‰ | per mille | \permil
    ‱ | per ten thousand
    ′ | prime
    † | dagger; adjoint | \dagger
    ‡ | double dagger | \ddagger
    ⊗ | tensor | \otimes
    ⊙ | circled dot | \odot
    … | ellipsis; dots | \ldots \dots
    ⋯ | centered dots | \cdots
    ⋮ | vertical dots | \vdots
    ⋱ | diagonal dots | \ddots
    ℘ | weierstrass p | \wp
    ℜ | real part | \Re
    ℑ | imaginary part | \Im
    ⟨ | left angle bracket | \langle
    ⟩ | right angle bracket | \rangle
    ‖ | double vertical bar; norm | \|
    § | section | \S
    ¶ | paragraph | \P
    • | bullet | \bullet
    ★ | star | \bigstar
    ✓ | check mark; tick | \checkmark
    ✗ | cross; ballot x
    ℮ | estimated
    ∎ | end of proof | \qed
  `],
];

let curated: Category[] | null = null;
export function categories(): Category[] {
  return (curated ??= CURATED.map(([id, label, src]) => ({ id, label, items: typeof src === 'function' ? src() : parse(src) })));
}

let blocks: Category[] | null = null;
/** Every character, by Unicode block. */
export function unicodeBlocks(): Category[] {
  return (blocks ??= UNICODE_BLOCKS.map(([label, runs], i) => {
    const items: Sym[] = [];
    for (const run of runs.split('~')) {
      const colon = run.indexOf(':');
      let cp = parseInt(run.slice(0, colon), 16);
      for (const name of run.slice(colon + 1).split('|')) {
        const text = String.fromCodePoint(cp++);
        items.push({ text, name, aliases: [], tex: [], ...(/\p{M}/u.test(text) ? { show: `◌${text}` } : {}) });
      }
    }
    return { id: `u${i}`, label, items };
  }));
}

export const catalogSize = (): number => {
  const seen = new Set<string>();
  for (const c of [...categories(), ...unicodeBlocks()]) for (const s of c.items) seen.add(s.text);
  return seen.size;
};
export { UNICODE_COUNT };

/**
 * Finds symbols by name, alias, LaTeX command ("\leq") or the character itself. Hand-picked entries rank above
 * the Unicode tables; exact and whole-word matches above partial ones. Each character appears once.
 */
export function search(query: string, extra: Sym[] = [], limit = 150): Sym[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const tex = q.startsWith('\\');
  const scored: { s: Sym; score: number }[] = [];
  const consider = (s: Sym, base: number) => {
    let best = Infinity;
    if (s.text.toLowerCase() === q) best = 0;
    if (tex) {
      for (const t of s.tex) {
        const lt = t.toLowerCase();
        if (lt === q) best = Math.min(best, 0);
        else if (lt.startsWith(q)) best = Math.min(best, 2);
      }
    } else {
      for (const n of [s.name, ...s.aliases]) {
        const ln = n.toLowerCase();
        if (ln === q) best = Math.min(best, 1);
        else if (ln.startsWith(q)) best = Math.min(best, 2);
        else if (new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(ln)) best = Math.min(best, 3);
        else if (ln.includes(q)) best = Math.min(best, 5);
      }
      for (const t of s.tex) if (t.slice(1).toLowerCase() === q) best = Math.min(best, 1);
    }
    if (best < Infinity) scored.push({ s, score: best * 10 + base });
  };
  for (const s of extra) consider(s, 0);
  for (const c of categories()) for (const s of c.items) consider(s, 1);
  for (const c of unicodeBlocks()) for (const s of c.items) consider(s, 4);
  scored.sort((a, b) => a.score - b.score);
  const seen = new Set<string>();
  const out: Sym[] = [];
  for (const { s } of scored) {
    if (seen.has(s.text)) continue;
    seen.add(s.text);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

/** Looks a character up for its name (recently used symbols are stored as text only). */
export function describe(text: string): Sym {
  for (const c of categories()) for (const s of c.items) if (s.text === text) return s;
  for (const c of unicodeBlocks()) for (const s of c.items) if (s.text === text) return s;
  return { text, name: text, aliases: [], tex: [] };
}
