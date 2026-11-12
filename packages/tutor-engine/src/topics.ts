/**
 * Teaching notes for the 13 practice topics: what the idea is, the rules worth remembering, why they
 * work, the classic traps, and the hooks each teaching style needs. All wording is original.
 */
import type { Difficulty, Question, Topic } from '@lemma/practice-engine';

export interface Line {
  text: string;
  tex?: string;
  say: string;
}

export interface RuleNote {
  heading: string;
  tex: string;
  note?: string;
  say: string;
}

export interface MistakeNote {
  wrong: string;
  wrongTex?: string;
  right: string;
  rightTex?: string;
  say: string;
}

export interface GraphNote {
  /** Graph-engine expressions in x. */
  exprs: string[];
  caption: string;
  xRange?: [number, number];
  yRange?: [number, number];
  mark?: { x: number; y: number; label?: string }[];
  /** What to notice, spoken. */
  say: string;
}

export interface Subtopic {
  id: string;
  name: string;
  /** Phrases that name this subtopic ("chain rule", "completing the square"). */
  phrases: RegExp;
  /** Difficulties whose generated questions can show it. */
  difficulties: Difficulty[];
  /** Matches a generated question (prompt + steps) that really uses this subtopic. */
  match?: RegExp;
  rule?: RuleNote;
  /** Said plainly when the examples can't show the subtopic itself. */
  caveat?: string;
  mistake?: MistakeNote;
  why?: { heading: string; intro: string; steps: Line[] };
}

export interface TopicNote {
  id: Topic;
  name: string;
  definition: string;
  definitionTex?: string;
  /** Spoken version of the definition. */
  defSay: string;
  rules: RuleNote[];
  why: { heading: string; intro: string; steps: Line[] };
  mistakes: MistakeNote[];
  hook: string;
  /** Which picture helps, in words. */
  graphHelps: string;
  graph: GraphNote;
  /** Exam: "when you see …, think …". */
  pattern: { see: string; think: string };
  /** Chalkboard: the question underneath the question. */
  asking: string;
  /** Chalkboard close. */
  bigIdea: string;
  /** Quick: the one idea that makes it click. */
  oneIdea: string;
  /** Exam: a fast way to check. */
  checkTip: string;
  summary: string[];
  subtopics: Subtopic[];
}

const L = (text: string, say: string, tex?: string): Line => (tex === undefined ? { text, say } : { text, tex, say });

export const NOTES: Record<Topic, TopicNote> = {
  arithmetic: {
    id: 'arithmetic',
    name: 'Order of operations',
    definition: 'Order of operations is the agreement about which part of a calculation to do first, so everyone gets the same answer from the same expression.',
    defSay: 'Order of operations is just an agreement about which part of a calculation happens first, so that everyone reading the same expression gets the same answer.',
    rules: [
      {
        heading: 'Brackets, powers, then × ÷, then + −',
        tex: '(\\ ) \\;\\to\\; a^n \\;\\to\\; \\times\\ \\div \\;\\to\\; +\\ -',
        note: 'Multiplication and division share a level: go left to right. Same for addition and subtraction.',
        say: 'Brackets first, then powers, then multiplication and division, then addition and subtraction. Within a level, work left to right.',
      },
    ],
    why: {
      heading: 'Why multiplication comes before addition',
      intro: 'Multiplication is shorthand for repeated addition, so it has to be unpacked before you add it to anything.',
      steps: [
        L('3 + 2 × 4 means 3 plus two fours.', 'Three plus two times four means three plus two fours.', '3 + 2 \\times 4 = 3 + (4 + 4)'),
        L('Two fours is 8, so the total is 11.', 'Two fours is eight, so the total is eleven.', '3 + 8 = 11'),
        L('Adding first would give 5 × 4 = 20, a different question.', 'If you added first you would get five times four, twenty, which answers a different question.', '(3 + 2) \\times 4 = 20'),
      ],
    },
    mistakes: [
      {
        wrong: '10 − 4 + 3 = 10 − 7 = 3',
        wrongTex: '10 - 4 + 3 = 10 - 7 = 3',
        right: 'Left to right: 10 − 4 + 3 = 6 + 3 = 9',
        rightTex: '10 - 4 + 3 = 6 + 3 = 9',
        say: 'Addition does not beat subtraction. They share a level, so go left to right: ten minus four is six, plus three is nine.',
      },
      {
        wrong: '−3² = 9',
        wrongTex: '-3^2 = 9',
        right: '−3² = −9, but (−3)² = 9',
        rightTex: '-3^2 = -9,\\quad (-3)^2 = 9',
        say: 'The power grabs only the three unless the minus sign is inside brackets.',
      },
    ],
    hook: 'Spreadsheets and calculators follow this order, which is why typing a formula without brackets can quietly give the wrong total.',
    graphHelps: 'A number line, to watch each operation move the running value.',
    graph: { exprs: ['0'], caption: 'A number line: each operation moves the running total.', xRange: [-5, 15], yRange: [-1, 1], say: 'Think of a number line. Each operation picks up the running total and moves it, and the order of the moves matters.' },
    pattern: { see: 'a mix of brackets, powers and all four operations', think: 'clear brackets, then powers, then times and divide left to right, then plus and minus left to right' },
    asking: 'What we really want is the one value everyone agrees this expression stands for.',
    bigIdea: 'The order is not arbitrary: multiplication is packed-up addition and powers are packed-up multiplication, so you unpack the strongest operations first.',
    oneIdea: 'Do the strongest operations first: brackets, powers, then times and divide, then plus and minus.',
    checkTip: 'Re-do it with brackets written around every multiplication; if the answer changes, an operation was done out of order.',
    summary: ['Brackets, powers, × ÷, + −.', '× and ÷ share a level: left to right.', '+ and − share a level: left to right.', 'A minus sign outside brackets is not squared.'],
    subtopics: [{ id: 'order-of-operations', name: 'Order of operations', phrases: /order of operations|bodmas|pemdas|bidmas/i, difficulties: [1, 2, 3] }],
  },

  fractions: {
    id: 'fractions',
    name: 'Fractions',
    definition: 'A fraction a/b means a parts of a whole that has been cut into b equal parts.',
    definitionTex: '\\frac{a}{b}',
    defSay: 'A fraction a over b means a pieces of a whole that has been cut into b equal pieces.',
    rules: [
      { heading: 'Adding and subtracting', tex: '\\frac{a}{b} + \\frac{c}{d} = \\frac{ad + bc}{bd}', note: 'In practice, use the least common denominator.', say: 'To add or subtract, first make the pieces the same size with a common denominator, then add the tops.' },
      { heading: 'Multiplying', tex: '\\frac{a}{b} \\times \\frac{c}{d} = \\frac{ac}{bd}', say: 'To multiply, multiply straight across: tops together, bottoms together.' },
      { heading: 'Dividing', tex: '\\frac{a}{b} \\div \\frac{c}{d} = \\frac{a}{b} \\times \\frac{d}{c}', say: 'To divide, flip the second fraction and multiply.' },
    ],
    why: {
      heading: 'Why you need a common denominator',
      intro: 'You can only count pieces together when they are the same size.',
      steps: [
        L('1/2 and 1/3 are different-sized pieces.', 'A half and a third are pieces of different sizes.', '\\frac{1}{2},\\ \\frac{1}{3}'),
        L('Cut both into sixths: 1/2 = 3/6 and 1/3 = 2/6.', 'Cut everything into sixths. A half is three sixths, and a third is two sixths.', '\\frac{1}{2} = \\frac{3}{6},\\quad \\frac{1}{3} = \\frac{2}{6}'),
        L('Now the pieces match, so count them: 5/6.', 'Now the pieces match, so we can count them: five sixths.', '\\frac{3}{6} + \\frac{2}{6} = \\frac{5}{6}'),
      ],
    },
    mistakes: [
      {
        wrong: '1/2 + 1/3 = 2/5',
        wrongTex: '\\frac{1}{2} + \\frac{1}{3} = \\frac{2}{5}',
        right: '1/2 + 1/3 = 3/6 + 2/6 = 5/6',
        rightTex: '\\frac{1}{2} + \\frac{1}{3} = \\frac{3}{6} + \\frac{2}{6} = \\frac{5}{6}',
        say: 'Adding the tops and adding the bottoms gives two fifths, which is less than a half on its own. That cannot be right. Match the denominators first.',
      },
      {
        wrong: '(2/3) ÷ (4/5) = (3/2) × (4/5)',
        wrongTex: '\\frac{2}{3} \\div \\frac{4}{5} = \\frac{3}{2} \\times \\frac{4}{5}',
        right: 'Flip the second fraction: (2/3) × (5/4) = 10/12 = 5/6',
        rightTex: '\\frac{2}{3} \\times \\frac{5}{4} = \\frac{5}{6}',
        say: 'Flip the fraction you are dividing by, not the first one.',
      },
    ],
    hook: 'Recipes, measurements in inches, and splitting a bill unevenly all come down to fraction arithmetic.',
    graphHelps: 'A number line between 0 and 1, so each fraction is a point and the sum is a longer jump.',
    graph: { exprs: ['0'], caption: 'Fractions as points on a number line from 0 to 1.', xRange: [-0.2, 1.2], yRange: [-1, 1], mark: [{ x: 0.5, y: 0, label: '1/2' }, { x: 1 / 3, y: 0, label: '1/3' }, { x: 5 / 6, y: 0, label: '5/6' }], say: 'Picture the number line from zero to one. A fraction is just a point on it, and adding fractions is putting one jump after another.' },
    pattern: { see: 'fractions joined by plus or minus', think: 'common denominator first; for times, go straight across; for divide, flip the second and multiply' },
    asking: 'What we are really asking is how many equal-sized pieces we end up with.',
    bigIdea: 'Every fraction rule is about keeping the pieces the same size, or changing the piece size without changing the amount.',
    oneIdea: 'Pieces must be the same size before you can add them.',
    checkTip: 'Turn each fraction into a rough decimal; the answer should match the decimal sum to a couple of places.',
    summary: ['Add or subtract: common denominator, then combine the tops.', 'Multiply: straight across.', 'Divide: flip the second fraction and multiply.', 'Simplify by dividing top and bottom by the same number.'],
    subtopics: [
      { id: 'adding-fractions', name: 'Adding and subtracting fractions', phrases: /add(?:ing)? fractions|subtract(?:ing)? fractions|common denominator|lcd\b/i, difficulties: [1, 2], match: /Calculate [-−]?\d+\/\d+ [+−] \d+\/\d+\./ },
      { id: 'multiplying-fractions', name: 'Multiplying fractions', phrases: /multiply(?:ing)? fractions/i, difficulties: [1], match: /×/, rule: { heading: 'Multiplying', tex: '\\frac{a}{b} \\times \\frac{c}{d} = \\frac{ac}{bd}', say: 'To multiply fractions, multiply the tops together and the bottoms together, then simplify.' } },
      { id: 'dividing-fractions', name: 'Dividing fractions', phrases: /divid(?:e|ing) fractions|reciprocal/i, difficulties: [2, 3], match: /÷/, rule: { heading: 'Dividing', tex: '\\frac{a}{b} \\div \\frac{c}{d} = \\frac{a}{b} \\times \\frac{d}{c}', say: 'Dividing by a fraction is the same as multiplying by its flip, its reciprocal.' } },
    ],
  },

  percent: {
    id: 'percent',
    name: 'Percentages',
    definition: 'Percent means "per hundred": p% is the fraction p/100.',
    definitionTex: 'p\\% = \\frac{p}{100}',
    defSay: 'Percent means per hundred. So p percent is just the fraction p over one hundred.',
    rules: [
      { heading: 'Percent of a number', tex: 'p\\%\\ \\text{of}\\ N = \\frac{p}{100} \\times N', say: 'To find p percent of a number, turn the percent into a decimal and multiply.' },
      { heading: 'Percent change', tex: '\\text{change}\\ \\% = \\frac{\\text{new} - \\text{old}}{\\text{old}} \\times 100', say: 'Percent change is the change divided by the original amount, times one hundred.' },
    ],
    why: {
      heading: 'Why you divide by 100',
      intro: 'A percent is a fraction with a fixed denominator of one hundred.',
      steps: [
        L('20% means 20 out of every 100.', 'Twenty percent means twenty out of every hundred.', '20\\% = \\frac{20}{100}'),
        L('That fraction is 0.2 as a decimal.', 'As a decimal that is zero point two.', '\\frac{20}{100} = 0.2'),
        L('"Of" means multiply, so 20% of 450 is 0.2 × 450 = 90.', 'The word of means multiply, so twenty percent of four hundred fifty is zero point two times four hundred fifty, which is ninety.', '0.2 \\times 450 = 90'),
      ],
    },
    mistakes: [
      {
        wrong: 'Up 25% then down 25% gets you back where you started',
        right: '1.25 × 0.75 = 0.9375, a 6.25% drop overall',
        rightTex: '1.25 \\times 0.75 = 0.9375',
        say: 'Percent changes multiply, they do not add. The second change is a percent of a different, bigger amount.',
      },
      {
        wrong: 'Percent change = change ÷ new value',
        wrongTex: '\\frac{\\text{new} - \\text{old}}{\\text{new}}',
        right: 'Divide by the original value',
        rightTex: '\\frac{\\text{new} - \\text{old}}{\\text{old}}',
        say: 'Always measure a change against where you started.',
      },
    ],
    hook: 'Sale prices, interest rates, test scores and poll results are all reported in percent.',
    graphHelps: 'A straight line through the origin, y = (p/100)x: the percent is the slope.',
    graph: { exprs: ['0.2x'], caption: 'y = 0.2x: twenty percent of any amount.', xRange: [0, 500], yRange: [0, 120], mark: [{ x: 450, y: 90, label: '20% of 450' }], say: 'Twenty percent of an amount is a straight line through zero. Double the amount and twenty percent of it doubles too. The percent is the slope.' },
    pattern: { see: 'the word "of" next to a percent', think: 'decimal times the amount; for a change, divide by the original' },
    asking: 'What we really want is a part of a whole, measured in hundredths.',
    bigIdea: 'A percent is just a fraction out of one hundred, so every percent question is a multiplication or a division in disguise.',
    oneIdea: 'Percent means per hundred, so divide by one hundred and multiply.',
    checkTip: 'Find 10% by moving the decimal point one place left, then scale it; your answer should be close.',
    summary: ['p% = p/100.', '"Of" means multiply.', 'Percent change divides by the original amount.', 'Successive changes multiply.'],
    subtopics: [
      { id: 'percent-of', name: 'Percent of a number', phrases: /percent of|% of|percentage of/i, difficulties: [1], match: /% of/ },
      { id: 'percent-change', name: 'Percent change', phrases: /percent(?:age)? (?:change|increase|decrease)|markup/i, difficulties: [2], match: /percent (?:increase|decrease)/, rule: { heading: 'Percent change', tex: '\\frac{\\text{new} - \\text{old}}{\\text{old}} \\times 100', say: 'Percent change: the change, divided by the original amount, times one hundred.' } },
      {
        id: 'reverse-percent',
        name: 'Reverse percentages',
        phrases: /reverse percent|original price|before (?:the )?(?:discount|increase)/i,
        difficulties: [3],
        match: /original price/,
        rule: { heading: 'Undoing a percent change', tex: '\\text{original} = \\frac{\\text{new}}{\\text{multiplier}}', say: 'To undo a percent change, divide by the multiplier. Never add the percent back on.' },
      },
    ],
  },

  linear: {
    id: 'linear',
    name: 'Linear equations',
    definition: 'A linear equation has x only to the first power. Solving it means finding the value of x that makes both sides equal.',
    definitionTex: 'ax + b = c',
    defSay: 'A linear equation has x only to the first power, no squares. Solving it means finding the value of x that makes both sides equal.',
    rules: [
      { heading: 'Keep the balance', tex: 'a = b \\;\\Rightarrow\\; a + k = b + k,\\quad \\frac{a}{k} = \\frac{b}{k}', note: 'Whatever you do to one side, do to the other (and never divide by zero).', say: 'An equation is a balance. Whatever you do to one side, you do to the other, and the balance stays level.' },
      { heading: 'Undo in reverse order', tex: 'ax + b = c \\;\\Rightarrow\\; x = \\frac{c - b}{a}', say: 'Undo what was done to x in reverse order: first remove the added number, then divide by the coefficient.' },
    ],
    why: {
      heading: 'Why "do the same to both sides" works',
      intro: 'If two quantities are equal, they stay equal after the same change.',
      steps: [
        L('Start with 2x + 3 = 11: two equal amounts.', 'Start with two x plus three equals eleven. The two sides are the same amount.', '2x + 3 = 11'),
        L('Take 3 from each: still equal.', 'Take three away from each side. Equal amounts minus the same thing are still equal.', '2x = 8'),
        L('Halve each: still equal, and now x stands alone.', 'Halve each side. Still equal, and now x is on its own.', 'x = 4'),
      ],
    },
    mistakes: [
      {
        wrong: '2x + 3 = 11 → 2x = 14',
        wrongTex: '2x + 3 = 11 \\;\\Rightarrow\\; 2x = 14',
        right: 'Subtract 3 from both sides: 2x = 8',
        rightTex: '2x + 3 = 11 \\;\\Rightarrow\\; 2x = 8',
        say: 'Moving the three across means subtracting it from both sides, so its sign flips. It does not get added to the other side.',
      },
      {
        wrong: '3(x + 2) = 15 → 3x + 2 = 15',
        wrongTex: '3(x + 2) = 3x + 2',
        right: 'The 3 multiplies both terms: 3x + 6 = 15',
        rightTex: '3(x + 2) = 3x + 6',
        say: 'The number outside the bracket multiplies everything inside it.',
      },
    ],
    hook: 'Working out how many hours you can work to hit a savings target, or when two phone plans cost the same, is solving a linear equation.',
    graphHelps: 'Graph each side as a line; the solution is where the lines cross.',
    graph: { exprs: ['2x + 3', '11'], caption: 'y = 2x + 3 and y = 11 cross at x = 4.', xRange: [-2, 8], yRange: [-2, 16], mark: [{ x: 4, y: 11, label: 'x = 4' }], say: 'Draw each side as its own line. The left side climbs, the right side is flat. The solution is the one x where they meet.' },
    pattern: { see: 'x to the first power on one or both sides', think: 'collect x terms on one side, numbers on the other, then divide' },
    asking: 'What we are really asking is: which number, put in for x, makes the two sides balance?',
    bigIdea: 'Solving is undoing. Every move keeps the two sides equal, so the last line is still true, and it tells you x.',
    oneIdea: 'Do the same thing to both sides until x is alone.',
    checkTip: 'Put your answer back into the original equation; both sides should give the same number.',
    summary: ['Keep both sides balanced.', 'Collect x terms on one side, numbers on the other.', 'Divide by the coefficient last.', 'Check by substituting back.'],
    subtopics: [
      { id: 'one-step', name: 'Two-step equations', phrases: /two[- ]step equations?|one[- ]step equations?/i, difficulties: [1] },
      { id: 'both-sides', name: 'Variables on both sides', phrases: /variables? on both sides|x on both sides/i, difficulties: [2, 3], match: /x .*=.*x/ },
      {
        id: 'slope',
        name: 'Slope and straight lines',
        phrases: /\bslope\b|gradient|y\s*=\s*mx|straight line|linear function/i,
        difficulties: [1, 2],
        rule: { heading: 'Slope', tex: 'm = \\frac{y_2 - y_1}{x_2 - x_1},\\quad y = mx + b', say: 'Slope is rise over run: the change in y divided by the change in x. A line is y equals m x plus b.' },
        caveat: 'The worked examples here solve equations: finding where a line reaches a given height is the same skill.',
      },
    ],
  },

  quadratic: {
    id: 'quadratic',
    name: 'Quadratic equations',
    definition: 'A quadratic equation has x² as its highest power. It can have two, one, or no real solutions.',
    definitionTex: 'ax^2 + bx + c = 0',
    defSay: 'A quadratic equation has x squared as its highest power. It can have two real solutions, one, or none.',
    rules: [
      { heading: 'Zero product', tex: 'pq = 0 \\;\\Rightarrow\\; p = 0 \\ \\text{or}\\ q = 0', note: 'Factor, then set each factor to zero.', say: 'If two things multiply to zero, at least one of them is zero. So factor, then set each factor to zero.' },
      { heading: 'Quadratic formula', tex: 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}', note: 'Works every time, even when factoring is awkward.', say: 'When it will not factor nicely, the quadratic formula always works: x equals negative b plus or minus the square root of b squared minus four a c, all over two a.' },
    ],
    why: {
      heading: 'Where the formula comes from',
      intro: 'Completing the square on the general equation produces the formula.',
      steps: [
        L('Divide by a and move c across.', 'Divide by a and move c to the other side.', 'x^2 + \\frac{b}{a}x = -\\frac{c}{a}'),
        L('Add (b/2a)² to both sides to make a perfect square.', 'Add b over two a, squared, to both sides. The left side becomes a perfect square.', '\\left(x + \\frac{b}{2a}\\right)^2 = \\frac{b^2 - 4ac}{4a^2}'),
        L('Square-root both sides, remembering ±.', 'Take the square root of both sides, remembering plus or minus.', 'x + \\frac{b}{2a} = \\pm\\frac{\\sqrt{b^2 - 4ac}}{2a}'),
        L('Subtract b/2a.', 'Subtract b over two a, and there is the formula.', 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}'),
      ],
    },
    mistakes: [
      {
        wrong: 'x² = 9 → x = 3',
        wrongTex: 'x^2 = 9 \\;\\Rightarrow\\; x = 3',
        right: 'x = 3 or x = −3',
        rightTex: 'x = \\pm 3',
        say: 'Negative three squared is also nine. A square root step needs plus or minus.',
      },
      {
        wrong: 'x² − 5x = 6 → x(x − 5) = 6, so x = 6 or x − 5 = 6',
        wrongTex: 'x(x - 5) = 6',
        right: 'Move everything to one side first: x² − 5x − 6 = 0 → (x − 6)(x + 1) = 0',
        rightTex: 'x^2 - 5x - 6 = 0 \\;\\Rightarrow\\; (x - 6)(x + 1) = 0',
        say: 'The zero product rule only works when the other side is zero. Get everything onto one side first.',
      },
    ],
    hook: 'The height of a thrown ball, the area of a garden with a fixed fence, and profit curves are all quadratics.',
    graphHelps: 'The parabola y = ax² + bx + c; the solutions are where it crosses the x-axis.',
    graph: { exprs: ['x^2 - 5x + 6'], caption: 'y = x² − 5x + 6 crosses the x-axis at 2 and 3.', xRange: [-1, 6], yRange: [-2, 8], mark: [{ x: 2, y: 0, label: 'x = 2' }, { x: 3, y: 0, label: 'x = 3' }], say: 'A quadratic draws a U-shaped curve, a parabola. Solving it equal to zero means finding where that curve touches the x-axis.' },
    pattern: { see: 'an x squared term with everything equal to zero', think: 'try to factor; if the numbers are ugly, go straight to the formula' },
    asking: 'What we are really asking is: where does this curve hit zero?',
    bigIdea: 'Factoring turns one hard equation into two easy ones, because a product can only be zero if one of its factors is.',
    oneIdea: 'If a product is zero, one of the factors is zero.',
    checkTip: 'The two roots add to −b/a and multiply to c/a; check those before substituting.',
    summary: ['Get everything on one side, equal to zero.', 'Factor and set each factor to zero.', 'Otherwise use the quadratic formula.', 'The discriminant b² − 4ac tells you how many real roots.'],
    subtopics: [
      { id: 'factoring', name: 'Solving by factoring', phrases: /factor(?:ing|ise|ize)?\b/i, difficulties: [1, 2], match: /Factor/ },
      { id: 'quadratic-formula', name: 'The quadratic formula', phrases: /quadratic formula|discriminant/i, difficulties: [3], match: /quadratic formula/ },
      {
        id: 'completing-square',
        name: 'Completing the square',
        phrases: /complet(?:e|ing) the square/i,
        difficulties: [3],
        match: /quadratic formula/,
        rule: { heading: 'Completing the square', tex: 'x^2 + bx = \\left(x + \\frac{b}{2}\\right)^2 - \\left(\\frac{b}{2}\\right)^2', say: 'Half the coefficient of x, square it, add and subtract it. That turns x squared plus b x into a perfect square minus a number.' },
        caveat: 'The worked examples use the quadratic formula, which is completing the square done once in general.',
      },
    ],
  },

  system: {
    id: 'system',
    name: 'Systems of equations',
    definition: 'A system is two equations that must both be true at once. The solution is the pair (x, y) that satisfies both.',
    definitionTex: '\\begin{cases} a_1x + b_1y = c_1 \\\\ a_2x + b_2y = c_2 \\end{cases}',
    defSay: 'A system is two equations that have to be true at the same time. The solution is the one pair, x and y, that works in both.',
    rules: [
      { heading: 'Elimination', tex: '(a_1x + b_1y) - (a_2x + b_2y) = c_1 - c_2', note: 'Scale the equations so one variable has matching coefficients, then add or subtract.', say: 'Elimination: scale the equations so one variable lines up, then add or subtract to make it disappear.' },
      { heading: 'Substitution', tex: 'y = c - ax \\;\\Rightarrow\\; \\text{replace } y \\text{ in the other equation}', say: 'Substitution: solve one equation for a variable and put that expression into the other equation.' },
    ],
    why: {
      heading: 'Why adding equations is allowed',
      intro: 'Adding equal amounts to equal amounts keeps them equal.',
      steps: [
        L('x + y = 12 and x − y = 2 are both true.', 'Say x plus y equals twelve and x minus y equals two are both true.', 'x + y = 12,\\quad x - y = 2'),
        L('Add left sides and right sides: the y terms cancel.', 'Add the left sides together and the right sides together. The y terms cancel.', '2x = 14'),
        L('One equation, one unknown: x = 7, then y = 5.', 'Now there is one equation with one unknown. x is seven, and then y is five.', 'x = 7,\\ y = 5'),
      ],
    },
    mistakes: [
      {
        wrong: 'Subtracting equations but only changing the sign of the first term',
        wrongTex: '(3x + 2y) - (x - y) = 2x + y',
        right: 'Subtract every term: (3x + 2y) − (x − y) = 2x + 3y',
        rightTex: '(3x + 2y) - (x - y) = 2x + 3y',
        say: 'When you subtract a whole equation, every term changes sign, including the ones that were already negative.',
      },
      {
        wrong: 'Stopping after finding x',
        right: 'Substitute back to find y, then check both equations',
        say: 'A system asks for both values. Finding x is only halfway.',
      },
    ],
    hook: 'Two prices and two receipts, or two phone plans with different fees, give two equations in two unknowns.',
    graphHelps: 'Each equation is a line; the solution is where the two lines cross.',
    graph: { exprs: ['12 - x', 'x - 2'], caption: 'y = 12 − x and y = x − 2 cross at (7, 5).', xRange: [0, 12], yRange: [-2, 12], mark: [{ x: 7, y: 5, label: '(7, 5)' }], say: 'Each equation is a straight line. Every point on a line satisfies that equation, so the point on both lines is the answer.' },
    pattern: { see: 'two equations with x and y', think: 'line up a variable and eliminate it, or substitute if one variable is already alone' },
    asking: 'What we are really asking is: which single point lies on both lines?',
    bigIdea: 'Two equations, two unknowns: combine them to knock one unknown out, and the problem becomes one you already know how to solve.',
    oneIdea: 'Combine the equations so one variable cancels.',
    checkTip: 'Substitute the pair into the equation you did not use for back-substitution.',
    summary: ['Line up one variable by scaling.', 'Add or subtract to eliminate it.', 'Solve, then substitute back.', 'Check in both original equations.'],
    subtopics: [
      { id: 'elimination', name: 'Elimination', phrases: /elimination|eliminate/i, difficulties: [1, 2, 3] },
      {
        id: 'substitution',
        name: 'Substitution',
        phrases: /substitution method|by substitution/i,
        difficulties: [1, 2],
        rule: { heading: 'Substitution', tex: 'y = c - ax \\;\\Rightarrow\\; \\text{replace } y', say: 'Get one variable on its own, then put that expression into the other equation.' },
        caveat: 'The worked examples use elimination; after the first step, substitution leads to the same numbers.',
      },
    ],
  },

  exponents: {
    id: 'exponents',
    name: 'Exponent rules',
    definition: 'An exponent counts repeated multiplication: xⁿ means n copies of x multiplied together.',
    definitionTex: 'x^n = \\underbrace{x \\cdot x \\cdots x}_{n}',
    defSay: 'An exponent counts repeated multiplication. x to the n means n copies of x multiplied together.',
    rules: [
      { heading: 'Same base: multiply → add', tex: 'x^a \\cdot x^b = x^{a+b}', say: 'Multiplying powers of the same base: add the exponents.' },
      { heading: 'Same base: divide → subtract', tex: '\\frac{x^a}{x^b} = x^{a-b}', say: 'Dividing: subtract the exponents.' },
      { heading: 'Power of a power → multiply', tex: '(x^a)^b = x^{ab}', say: 'A power of a power: multiply the exponents.' },
      { heading: 'Negative exponent → reciprocal', tex: 'x^{-n} = \\frac{1}{x^n}', say: 'A negative exponent means one over that power.' },
    ],
    why: {
      heading: 'Why exponents add when you multiply',
      intro: 'Count the copies.',
      steps: [
        L('x³ is three x’s multiplied; x² is two.', 'x cubed is three x’s multiplied together, x squared is two.', 'x^3 = x\\cdot x\\cdot x,\\quad x^2 = x\\cdot x'),
        L('Multiply them: five x’s in a row.', 'Multiply them and you have five x’s in a row.', 'x^3 \\cdot x^2 = x\\cdot x\\cdot x\\cdot x\\cdot x'),
        L('So x³ · x² = x⁵: the counts add.', 'So x cubed times x squared is x to the fifth. The counts add.', 'x^{3+2} = x^5'),
      ],
    },
    mistakes: [
      {
        wrong: 'x³ · x⁴ = x¹²',
        wrongTex: 'x^3 \\cdot x^4 = x^{12}',
        right: 'Add when multiplying: x³ · x⁴ = x⁷',
        rightTex: 'x^3 \\cdot x^4 = x^7',
        say: 'Multiplying the exponents is the rule for a power of a power. For a product, the exponents add.',
      },
      {
        wrong: '(2x)³ = 2x³',
        wrongTex: '(2x)^3 = 2x^3',
        right: 'The power applies to every factor: (2x)³ = 8x³',
        rightTex: '(2x)^3 = 8x^3',
        say: 'Everything inside the bracket gets cubed, including the two.',
      },
    ],
    hook: 'Compound growth, computer memory sizes, and scientific notation all run on exponent rules.',
    graphHelps: 'Plot the original expression and the simplified one: the curves sit exactly on top of each other.',
    graph: { exprs: ['x^3*x^2', 'x^5'], caption: 'x³ · x² and x⁵ draw the same curve.', xRange: [-1.5, 1.5], yRange: [-4, 4], say: 'Here is x cubed times x squared, and here is x to the fifth. They are the same curve, because they are the same function.' },
    pattern: { see: 'the same base raised to powers and multiplied, divided or raised again', think: 'add, subtract, or multiply the exponents' },
    asking: 'What we are really asking is: how many copies of each base are left?',
    bigIdea: 'Every exponent rule is just counting how many copies of the base you have.',
    oneIdea: 'An exponent is a count of copies, so multiplying adds the counts.',
    checkTip: 'Plug in x = 2 to the original and to your answer; they must give the same number.',
    summary: ['Multiply: add exponents.', 'Divide: subtract exponents.', 'Power of a power: multiply exponents.', 'Negative exponent: reciprocal.'],
    subtopics: [
      { id: 'product-quotient', name: 'Product and quotient rules for exponents', phrases: /product rule (?:for|of) exponents|quotient rule (?:for|of) exponents|exponent laws?|laws? of exponents|exponent rules?|index laws?/i, difficulties: [1, 2] },
      { id: 'power-of-power', name: 'Power of a power', phrases: /power of a power/i, difficulties: [2], match: /Power of a power/ },
      { id: 'negative-exponents', name: 'Negative exponents', phrases: /negative exponents?|negative powers?/i, difficulties: [2, 3], match: /negative exponent|\^−|\^-/ },
    ],
  },

  derivative: {
    id: 'derivative',
    name: 'Derivatives',
    definition: 'The derivative f′(x) is the slope of the curve y = f(x) at each point: how fast f changes as x changes.',
    definitionTex: "f'(x) = \\lim_{h \\to 0} \\frac{f(x + h) - f(x)}{h}",
    defSay: 'The derivative, f prime of x, is the slope of the curve at each point. It tells you how fast f is changing as x changes.',
    rules: [
      { heading: 'Power rule', tex: '\\frac{d}{dx}x^n = nx^{n-1}', say: 'The power rule: bring the power down in front, then lower the power by one.' },
      { heading: 'Chain rule', tex: '\\frac{d}{dx}f(g(x)) = f\'(g(x))\\,g\'(x)', say: 'The chain rule: differentiate the outside function, leave the inside alone, then multiply by the derivative of the inside.' },
      { heading: 'Product rule', tex: '(uv)\' = u\'v + uv\'', say: 'The product rule: derivative of the first times the second, plus the first times the derivative of the second.' },
    ],
    why: {
      heading: 'Why the power rule works',
      intro: 'Take x² and nudge x by a tiny amount h.',
      steps: [
        L('(x + h)² = x² + 2xh + h².', 'x plus h, squared, is x squared plus two x h plus h squared.', '(x + h)^2 = x^2 + 2xh + h^2'),
        L('The change is 2xh + h²; divide by h.', 'The change in the output is two x h plus h squared. Divide by h to get the average slope.', '\\frac{2xh + h^2}{h} = 2x + h'),
        L('As h shrinks to 0, the slope becomes 2x.', 'As h shrinks to zero, that slope becomes two x. That is the power rule for n equals two.', '\\frac{d}{dx}x^2 = 2x'),
      ],
    },
    mistakes: [
      {
        wrong: 'd/dx sin(x²) = cos(x²)',
        wrongTex: '\\frac{d}{dx}\\sin(x^2) = \\cos(x^2)',
        right: 'Multiply by the inside’s derivative: 2x cos(x²)',
        rightTex: '\\frac{d}{dx}\\sin(x^2) = 2x\\cos(x^2)',
        say: 'Forgetting the inside is the most common calculus slip. The inside, x squared, changes too, at rate two x.',
      },
      {
        wrong: 'd/dx x³ = 3x³',
        wrongTex: '\\frac{d}{dx}x^3 = 3x^3',
        right: 'Lower the power by one: 3x²',
        rightTex: '\\frac{d}{dx}x^3 = 3x^2',
        say: 'Bringing the power down is only half the rule. The power also drops by one.',
      },
    ],
    hook: 'Speed is the derivative of position; marginal cost is the derivative of total cost.',
    graphHelps: 'The curve with a tangent line touching it: the derivative is that line’s slope.',
    graph: { exprs: ['x^2', '2x - 1'], caption: 'y = x² and its tangent line at x = 1, slope 2.', xRange: [-2, 3], yRange: [-2, 6], mark: [{ x: 1, y: 1, label: 'slope 2' }], say: 'Here is a curve and a straight line that just touches it. Zoom in far enough and the curve looks like that line. The derivative is the slope of that line.' },
    pattern: { see: 'a function to differentiate', think: 'power rule term by term; if there is a function inside a function, chain rule; if two functions are multiplied, product rule' },
    asking: 'What we are really asking is: how steep is this curve at every point?',
    bigIdea: 'A derivative is a slope that changes from point to point, and every rule is a shortcut for the limit of rise over run.',
    oneIdea: 'Bring the power down and lower it by one, and multiply by the inside’s derivative if there is one.',
    checkTip: 'Compare with the slope of the curve between two nearby points, like x = 0.999 and x = 1.001.',
    summary: ['Derivative = slope of the tangent line.', 'Power rule: n·xⁿ⁻¹.', 'Chain rule: outside′ × inside′.', 'Product rule: u′v + uv′.'],
    subtopics: [
      {
        id: 'power-rule',
        name: 'The power rule',
        phrases: /power rule/i,
        difficulties: [1],
        match: /Power rule/,
        rule: { heading: 'Power rule', tex: '\\frac{d}{dx}x^n = nx^{n-1}', say: 'The power rule: bring the power down in front, then lower the power by one.' },
      },
      {
        id: 'chain-rule',
        name: 'The chain rule',
        phrases: /chain rule|composite functions?/i,
        difficulties: [3],
        match: /Chain rule/,
        rule: { heading: 'Chain rule', tex: "\\frac{d}{dx}f(g(x)) = f'(g(x))\\,g'(x)", note: 'Outside’s derivative, inside kept, times inside’s derivative.', say: 'The chain rule: differentiate the outside function, leave the inside alone, then multiply by the derivative of the inside.' },
        mistake: {
          wrong: 'd/dx (x² + 1)³ = 3(x² + 1)²',
          wrongTex: '\\frac{d}{dx}(x^2 + 1)^3 = 3(x^2 + 1)^2',
          right: 'Multiply by the inside’s derivative 2x: 6x(x² + 1)²',
          rightTex: '\\frac{d}{dx}(x^2 + 1)^3 = 6x(x^2 + 1)^2',
          say: 'The outside part was right, but the inside, x squared plus one, is changing too. Multiply by its derivative, two x.',
        },
        why: {
          heading: 'Why the rates multiply',
          intro: 'Think of the inside as a gear driving the outside.',
          steps: [
            L('Let u = g(x); the outside is f(u).', 'Call the inside u. The outside function only sees u.', 'u = g(x),\\quad y = f(u)'),
            L('y changes f′(u) times as fast as u.', 'y changes f prime of u times as fast as u does.', '\\frac{dy}{du} = f\'(u)'),
            L('u changes g′(x) times as fast as x.', 'And u changes g prime of x times as fast as x.', '\\frac{du}{dx} = g\'(x)'),
            L('So y changes f′(u)·g′(x) times as fast as x.', 'So y changes the product of those two rates times as fast as x.', '\\frac{dy}{dx} = \\frac{dy}{du}\\cdot\\frac{du}{dx}'),
          ],
        },
      },
      {
        id: 'product-rule',
        name: 'The product rule',
        phrases: /product rule(?! (?:for|of) exponents)/i,
        difficulties: [3],
        match: /Product rule/,
        rule: { heading: 'Product rule', tex: "(uv)' = u'v + uv'", say: 'The product rule: derivative of the first times the second, plus the first times the derivative of the second.' },
        mistake: {
          wrong: '(uv)′ = u′v′',
          wrongTex: "(uv)' = u'v'",
          right: '(uv)′ = u′v + uv′',
          rightTex: "(uv)' = u'v + uv'",
          say: 'The derivative of a product is not the product of the derivatives. Each factor takes a turn being differentiated.',
        },
      },
      { id: 'trig-exp-log', name: 'Derivatives of sin, cos, eˣ and ln', phrases: /derivatives? of (?:sin|cos|trig|e\^?x|exponential|ln|log)/i, difficulties: [2], match: /sin|cos|ln|e\^/ },
    ],
  },

  integral: {
    id: 'integral',
    name: 'Integrals',
    definition: 'An integral undoes a derivative. The definite integral from a to b adds up the signed area under the curve between a and b.',
    definitionTex: '\\int_a^b f(x)\\,dx = F(b) - F(a)',
    defSay: 'An integral undoes a derivative. The definite integral from a to b adds up the area under the curve between a and b, counting area below the axis as negative.',
    rules: [
      { heading: 'Power rule for integrals', tex: '\\int x^n\\,dx = \\frac{x^{n+1}}{n+1} + C,\\quad n \\ne -1', say: 'To integrate x to the n, raise the power by one and divide by the new power. Then add C.' },
      { heading: 'Fundamental theorem', tex: '\\int_a^b f(x)\\,dx = F(b) - F(a)', say: 'For a definite integral, find an antiderivative F, then take F at the top limit minus F at the bottom limit.' },
    ],
    why: {
      heading: 'Why you raise the power and divide',
      intro: 'Integration runs the power rule backwards.',
      steps: [
        L('Differentiating x³ gives 3x².', 'Differentiating x cubed gives three x squared.', '\\frac{d}{dx}x^3 = 3x^2'),
        L('So x³/3 differentiates to x².', 'So x cubed over three differentiates to plain x squared.', '\\frac{d}{dx}\\frac{x^3}{3} = x^2'),
        L('Adding any constant changes nothing, hence + C.', 'Adding any constant does not change the derivative, which is why every antiderivative carries plus C.', '\\int x^2\\,dx = \\frac{x^3}{3} + C'),
      ],
    },
    mistakes: [
      {
        wrong: '∫ x² dx = x³',
        wrongTex: '\\int x^2\\,dx = x^3',
        right: 'Divide by the new power and add C: x³/3 + C',
        rightTex: '\\int x^2\\,dx = \\frac{x^3}{3} + C',
        say: 'Differentiate your answer to check. x cubed gives three x squared, three times too much.',
      },
      {
        wrong: '∫₀² f dx = F(0) − F(2)',
        wrongTex: '\\int_0^2 f\\,dx = F(0) - F(2)',
        right: 'Top limit minus bottom limit: F(2) − F(0)',
        rightTex: '\\int_0^2 f\\,dx = F(2) - F(0)',
        say: 'Always the top limit first, then subtract the bottom.',
      },
    ],
    hook: 'Distance from a speed graph, total rainfall from a rate, and the area of a curved region are all integrals.',
    graphHelps: 'The curve with the region under it shaded between the limits.',
    graph: { exprs: ['x^2'], caption: 'The area under y = x² from 0 to 2 is 8/3.', xRange: [-0.5, 2.5], yRange: [-0.5, 5], mark: [{ x: 0, y: 0, label: 'a = 0' }, { x: 2, y: 4, label: 'b = 2' }], say: 'Look at the region under this curve, from zero to two. The integral is that area, built up from thin strips.' },
    pattern: { see: 'a sum of powers inside an integral sign', think: 'raise each power by one, divide by the new power, add C; with limits, top minus bottom' },
    asking: 'What we are really asking is: which function has this as its derivative?',
    bigIdea: 'Integration and differentiation undo each other, which is why the area under a curve can be found with an antiderivative.',
    oneIdea: 'Run the power rule backwards: raise the power, divide by it.',
    checkTip: 'Differentiate your answer; you should get the integrand back.',
    summary: ['Integration undoes differentiation.', 'Power rule: xⁿ⁺¹/(n + 1).', 'Indefinite integrals need + C.', 'Definite: F(b) − F(a).'],
    subtopics: [
      { id: 'antiderivative', name: 'Antiderivatives with the power rule', phrases: /antiderivatives?|indefinite integrals?|power rule/i, difficulties: [1], match: /Power rule/ },
      { id: 'definite', name: 'Definite integrals and area', phrases: /definite integrals?|area under|fundamental theorem/i, difficulties: [3], match: /from .* to/ },
      {
        id: 'u-substitution',
        name: 'Substitution',
        phrases: /u[- ]?sub(?:stitution)?|integration by substitution|substitution rule/i,
        difficulties: [3],
        match: /Substitute u/,
        rule: { heading: 'Substitution', tex: '\\int f(g(x))\\,g\'(x)\\,dx = \\int f(u)\\,du', say: 'Substitution is the chain rule in reverse: when the inside’s derivative is sitting next to it, rename the inside u.' },
      },
      {
        id: 'by-parts',
        name: 'Integration by parts',
        phrases: /by parts/i,
        difficulties: [3],
        match: /by parts/,
        rule: { heading: 'Integration by parts', tex: '\\int u\\,dv = uv - \\int v\\,du', say: 'Integration by parts is the product rule in reverse: the integral of u d v is u v minus the integral of v d u.' },
      },
    ],
  },

  units: {
    id: 'units',
    name: 'Unit conversion',
    definition: 'Converting units changes the label, not the amount: you multiply by a conversion factor that equals one.',
    definitionTex: '\\frac{100\\ \\text{cm}}{1\\ \\text{m}} = 1',
    defSay: 'Converting units changes the label, not the amount. You multiply by a conversion factor that is really just the number one in disguise.',
    rules: [
      { heading: 'Multiply by a factor equal to one', tex: '5\\ \\text{km} \\times \\frac{1000\\ \\text{m}}{1\\ \\text{km}} = 5000\\ \\text{m}', note: 'Arrange the factor so the old unit cancels.', say: 'Multiply by a fraction whose top and bottom are the same length or mass in different units, arranged so the old unit cancels.' },
      { heading: 'Squared and cubed units', tex: '1\\ \\text{m}^2 = (100\\ \\text{cm})^2 = 10\\,000\\ \\text{cm}^2', say: 'For area, square the factor. For volume, cube it.' },
    ],
    why: {
      heading: 'Why the amount does not change',
      intro: 'A conversion factor is a fraction equal to one.',
      steps: [
        L('100 cm and 1 m are the same length.', 'One hundred centimeters and one meter are the same length.', '100\\ \\text{cm} = 1\\ \\text{m}'),
        L('So 100 cm / 1 m = 1.', 'So the fraction one hundred centimeters over one meter equals one.', '\\frac{100\\ \\text{cm}}{1\\ \\text{m}} = 1'),
        L('Multiplying by 1 changes the units, never the size.', 'Multiplying by one changes how we write the amount, never the amount itself.', '8.2\\ \\text{m} \\times \\frac{100\\ \\text{cm}}{1\\ \\text{m}} = 820\\ \\text{cm}'),
      ],
    },
    mistakes: [
      {
        wrong: '1 m² = 100 cm²',
        wrongTex: '1\\ \\text{m}^2 = 100\\ \\text{cm}^2',
        right: '1 m² = 100² cm² = 10,000 cm²',
        rightTex: '1\\ \\text{m}^2 = 10\\,000\\ \\text{cm}^2',
        say: 'A square meter is a hundred centimeters on each side, so it holds a hundred times a hundred square centimeters.',
      },
      {
        wrong: '5 km = 5 ÷ 1000 m',
        wrongTex: '5\\ \\text{km} = 0.005\\ \\text{m}',
        right: 'Smaller unit means a bigger number: 5 km = 5000 m',
        rightTex: '5\\ \\text{km} = 5000\\ \\text{m}',
        say: 'Meters are smaller than kilometers, so you need more of them. The number should go up.',
      },
    ],
    hook: 'Recipes, travel distances, fuel economy and medicine doses all depend on getting conversions right.',
    graphHelps: 'A straight line through the origin whose slope is the conversion factor.',
    graph: { exprs: ['1.609344x'], caption: 'Kilometers = 1.609344 × miles: a straight line.', xRange: [0, 50], yRange: [0, 85], mark: [{ x: 30, y: 48.28032, label: '30 mi' }], say: 'Plot miles across and kilometers up. Every conversion sits on one straight line through zero, and its slope is the conversion factor.' },
    pattern: { see: 'an amount in one unit and a request for another', think: 'multiply by a factor that cancels the old unit; square it for area, cube it for volume' },
    asking: 'What we are really asking is: how do we write the same amount with a different label?',
    bigIdea: 'A conversion factor is just the number one written cleverly, so the amount never changes, only its label.',
    oneIdea: 'Multiply by a factor equal to one, arranged so the old unit cancels.',
    checkTip: 'Ask whether the number should go up or down: smaller units need bigger numbers.',
    summary: ['A conversion factor equals one.', 'Arrange it so the old unit cancels.', 'Smaller unit, bigger number.', 'Square the factor for area, cube it for volume.'],
    subtopics: [
      { id: 'metric', name: 'Metric conversions', phrases: /metric|kilo|centi|milli/i, difficulties: [1] },
      { id: 'imperial', name: 'Metric and imperial', phrases: /imperial|miles? to|inches? to|feet to|pounds? to|to miles|to inches|to feet|to pounds/i, difficulties: [2], match: /inch|mile|feet|foot|pound|gallon/ },
      { id: 'temperature', name: 'Temperature', phrases: /temperature|celsius|fahrenheit|kelvin/i, difficulties: [2], match: /°/, rule: { heading: 'Temperature', tex: 'F = \\tfrac{9}{5}C + 32', say: 'Temperature scales have different zeros, so you scale and shift: F equals nine fifths C plus thirty-two.' } },
      { id: 'compound-units', name: 'Area, volume and speed units', phrases: /square (?:meters|feet|units)|cubic|area units|speed units|km\/h|m\/s/i, difficulties: [3] },
    ],
  },

  stats: {
    id: 'stats',
    name: 'Statistics',
    definition: 'Summary statistics describe a data set with a few numbers: a center (mean, median, mode) and a spread (range, standard deviation).',
    defSay: 'Summary statistics describe a whole data set with a few numbers: where its center is, and how spread out it is.',
    rules: [
      { heading: 'Mean', tex: '\\bar{x} = \\frac{\\sum x_i}{n}', say: 'The mean is the sum of the values divided by how many there are.' },
      { heading: 'Median', tex: '\\text{median} = \\text{middle value of the sorted list}', say: 'The median is the middle value once the list is sorted. With an even count, average the two middle values.' },
      { heading: 'Standard deviation', tex: '\\sigma = \\sqrt{\\frac{\\sum (x_i - \\bar{x})^2}{n}}', say: 'Standard deviation: the square root of the average squared distance from the mean.' },
    ],
    why: {
      heading: 'Why the mean is a fair share',
      intro: 'The mean is what everyone would get if the total were shared equally.',
      steps: [
        L('Values 3, 5, 7, 9 total 24.', 'The values three, five, seven and nine add up to twenty-four.', '3 + 5 + 7 + 9 = 24'),
        L('Share 24 equally among 4: each gets 6.', 'Share twenty-four equally among four and each gets six.', '24 \\div 4 = 6'),
        L('The distances above and below 6 cancel: −3, −1, +1, +3.', 'Notice the distances from six cancel out: minus three, minus one, plus one, plus three.', '-3 - 1 + 1 + 3 = 0'),
      ],
    },
    mistakes: [
      {
        wrong: 'Median of 9, 2, 7 is 2 (the middle one as written)',
        right: 'Sort first: 2, 7, 9 → median 7',
        say: 'The median is the middle of the sorted list, not the middle of the list as it was written.',
      },
      {
        wrong: 'Standard deviation = average distance from the mean, without squaring',
        right: 'Square the distances, average them, then take the square root',
        rightTex: '\\sigma = \\sqrt{\\tfrac{1}{n}\\sum (x_i - \\bar{x})^2}',
        say: 'Plain distances above and below the mean cancel to zero. Squaring them first keeps every distance positive.',
      },
    ],
    hook: 'Average grades, typical house prices, and how consistent a player’s scores are all come from these summaries.',
    graphHelps: 'A dot plot on a number line, with the mean or median marked as the balance point.',
    graph: { exprs: ['0'], caption: 'Data on a number line; the mean is the balance point.', xRange: [0, 12], yRange: [-1, 1], mark: [{ x: 3, y: 0 }, { x: 5, y: 0 }, { x: 7, y: 0 }, { x: 9, y: 0 }, { x: 6, y: 0.5, label: 'mean 6' }], say: 'Put each value on a number line as a dot. The mean is where a ruler holding those dots would balance.' },
    pattern: { see: 'a list of numbers and "mean", "median" or "standard deviation"', think: 'mean: add and divide; median: sort first; spread: distances from the mean, squared' },
    asking: 'What we are really asking is: what single number best represents this whole list?',
    bigIdea: 'Center and spread are two different questions: the mean says where the data sits, the standard deviation says how tightly it sits there.',
    oneIdea: 'Mean is a fair share: add everything up and split it equally.',
    checkTip: 'The mean must sit between the smallest and largest values; multiply it by the count to get the total back.',
    summary: ['Mean = sum ÷ count.', 'Median: sort, take the middle.', 'Mode: most frequent value.', 'Standard deviation: root of the mean squared distance.'],
    subtopics: [
      { id: 'mean', name: 'The mean', phrases: /\bmean\b|\baverage\b/i, difficulties: [1], match: /mean/ },
      { id: 'median', name: 'The median', phrases: /\bmedian\b/i, difficulties: [2], match: /median/ },
      { id: 'mode', name: 'The mode', phrases: /\bmode\b/i, difficulties: [2], match: /mode/ },
      { id: 'range', name: 'The range', phrases: /\brange\b/i, difficulties: [2], match: /range/ },
      { id: 'standard-deviation', name: 'Standard deviation', phrases: /standard deviation|variance|std\b|spread/i, difficulties: [3], match: /standard deviation/ },
    ],
  },

  geometry: {
    id: 'geometry',
    name: 'Geometry',
    definition: 'Measurement geometry finds lengths, areas and volumes of shapes from a few known measurements.',
    defSay: 'Measurement geometry is about finding lengths, areas and volumes of shapes from a few measurements you already know.',
    rules: [
      { heading: 'Pythagorean theorem', tex: 'a^2 + b^2 = c^2', note: 'Right triangles only; c is the hypotenuse, opposite the right angle.', say: 'In a right triangle, the squares on the two legs add up to the square on the hypotenuse.' },
      { heading: 'Areas', tex: 'A_{\\text{rect}} = lw,\\quad A_{\\triangle} = \\tfrac12 bh,\\quad A_{\\circ} = \\pi r^2', say: 'Rectangle: length times width. Triangle: half base times height. Circle: pi r squared.' },
      { heading: 'Volumes', tex: 'V_{\\text{cyl}} = \\pi r^2 h,\\quad V_{\\text{cone}} = \\tfrac13 \\pi r^2 h,\\quad V_{\\text{sph}} = \\tfrac43 \\pi r^3', say: 'Cylinder: pi r squared h. A cone is a third of that. A sphere is four thirds pi r cubed.' },
    ],
    why: {
      heading: 'Why a triangle is half a rectangle',
      intro: 'Two copies of a triangle fit together into a rectangle.',
      steps: [
        L('Draw a rectangle b wide and h tall.', 'Draw a rectangle b wide and h tall.', 'A = bh'),
        L('A diagonal splits it into two identical triangles.', 'Cut along a diagonal and you get two identical triangles.', '2A_{\\triangle} = bh'),
        L('So each triangle has half the area.', 'So each triangle has half the area: one half b h.', 'A_{\\triangle} = \\tfrac12 bh'),
      ],
    },
    mistakes: [
      {
        wrong: 'Legs 3 and 4 → hypotenuse 3 + 4 = 7',
        wrongTex: 'c = a + b',
        right: 'Square, add, then square-root: √(9 + 16) = 5',
        rightTex: 'c = \\sqrt{a^2 + b^2} = 5',
        say: 'The sides themselves do not add; their squares do.',
      },
      {
        wrong: 'Using the diameter in πr²',
        wrongTex: 'A = \\pi d^2',
        right: 'Halve the diameter first: r = d/2',
        rightTex: 'A = \\pi \\left(\\tfrac{d}{2}\\right)^2',
        say: 'The formula wants the radius. Using the diameter makes the area four times too big.',
      },
    ],
    hook: 'Flooring, paint, fencing, and checking whether a TV fits a space all use these formulas.',
    graphHelps: 'Draw the shape on axes: a right triangle with its legs along the axes, or a circle centered at the origin.',
    graph: { exprs: ['4 - (4/3)x'], caption: 'A 3-4-5 right triangle with legs on the axes.', xRange: [-0.5, 4], yRange: [-0.5, 4.5], mark: [{ x: 0, y: 0, label: 'right angle' }, { x: 3, y: 0, label: '3' }, { x: 0, y: 4, label: '4' }], say: 'Put a right triangle on the axes, with the two legs along them. The slanted line joining their ends is the hypotenuse.' },
    pattern: { see: 'a right triangle with two sides known', think: 'Pythagoras; for area or volume, pick the formula and check you have the radius, not the diameter' },
    asking: 'What we are really asking is: which formula links what we know to what we want?',
    bigIdea: 'Every formula here comes from cutting and rearranging shapes, so a quick sketch usually tells you which one to use.',
    oneIdea: 'In a right triangle, the squares on the legs add up to the square on the hypotenuse.',
    checkTip: 'The hypotenuse must be the longest side; an area must be in square units, a volume in cubic units.',
    summary: ['Pythagoras: a² + b² = c², right triangles only.', 'Rectangle lw, triangle ½bh, circle πr².', 'Cylinder πr²h, cone ⅓πr²h, sphere ⁴⁄₃πr³.', 'Use the radius, not the diameter.'],
    subtopics: [
      {
        id: 'pythagorean',
        name: 'The Pythagorean theorem',
        phrases: /pythag|hypotenuse|right triangles?/i,
        difficulties: [2, 3],
        match: /Pythagoras/,
        rule: { heading: 'Pythagorean theorem', tex: 'a^2 + b^2 = c^2', note: 'c is the hypotenuse, opposite the right angle.', say: 'In a right triangle, a squared plus b squared equals c squared, where c is the side opposite the right angle.' },
        why: {
          heading: 'Why a² + b² = c²',
          intro: 'Arrange four copies of the triangle inside a big square.',
          steps: [
            L('Put four copies in a square of side a + b; a tilted square of side c is left in the middle.', 'Put four copies of the triangle inside a square with side a plus b. A tilted square, side c, is left in the middle.', '(a + b)^2 = 4\\cdot\\tfrac12 ab + c^2'),
            L('Expand the left side.', 'Expand the left side.', 'a^2 + 2ab + b^2 = 2ab + c^2'),
            L('Take 2ab from both sides.', 'Take two a b from both sides, and what is left is the theorem.', 'a^2 + b^2 = c^2'),
          ],
        },
      },
      { id: 'area', name: 'Area', phrases: /\barea\b/i, difficulties: [1, 2], match: /area/ },
      { id: 'perimeter', name: 'Perimeter', phrases: /perimeter|circumference/i, difficulties: [1, 2], match: /perimeter|circumference/ },
      { id: 'circles', name: 'Circles', phrases: /circles?\b|radius|diameter/i, difficulties: [2], match: /circle/ },
      {
        id: 'volume',
        name: 'Volume',
        phrases: /volume|cylinder|sphere|cone/i,
        difficulties: [3],
        match: /volume/,
        rule: { heading: 'Volumes', tex: 'V_{\\text{cyl}} = \\pi r^2 h,\\quad V_{\\text{cone}} = \\tfrac13 \\pi r^2 h,\\quad V_{\\text{sph}} = \\tfrac43 \\pi r^3', say: 'Cylinder: base area times height, pi r squared h. A cone holds a third of that. A sphere is four thirds pi r cubed.' },
      },
    ],
  },

  money: {
    id: 'money',
    name: 'Money and tips',
    definition: 'Everyday money math is percent math with rounding to the cent: tips, tax and discounts are percents of a price, and interest is a percent applied again and again.',
    defSay: 'Everyday money math is percent math, rounded to the cent. Tips, tax and discounts are percents of a price, and interest is a percent applied over and over.',
    rules: [
      { heading: 'Tip or tax', tex: '\\text{amount} = \\text{price} \\times \\frac{p}{100}', say: 'A tip or a tax is the price times the percent as a decimal.' },
      { heading: 'Discount then tax', tex: '\\text{pay} = \\text{price} \\times (1 - d) \\times (1 + t)', say: 'A discount multiplies by one minus the discount rate; tax multiplies by one plus the tax rate.' },
      { heading: 'Compound interest', tex: 'A = P\\left(1 + \\frac{r}{n}\\right)^{nt}', say: 'Compound interest: A equals P times one plus r over n, raised to the n t.' },
    ],
    why: {
      heading: 'Why a total uses 1 + rate',
      intro: 'Adding a percent on is the same as multiplying once.',
      steps: [
        L('A $40 bill plus a 20% tip is 40 + 0.2 × 40.', 'A forty dollar bill plus a twenty percent tip is forty plus zero point two times forty.', '40 + 0.2 \\times 40'),
        L('Factor out the 40.', 'Pull out the forty.', '40 \\times (1 + 0.2)'),
        L('So the total is 40 × 1.2 = 48.', 'So the total is forty times one point two, which is forty-eight dollars.', '40 \\times 1.2 = 48'),
      ],
    },
    mistakes: [
      {
        wrong: '20% off then 20% back on returns the original price',
        right: '0.8 × 1.2 = 0.96: you pay 4% less than the original',
        rightTex: '0.8 \\times 1.2 = 0.96',
        say: 'The second percent is taken of a different amount, so the changes do not cancel.',
      },
      {
        wrong: 'Rounding the tip before adding tax or splitting, then rounding again',
        right: 'Keep full precision until the last step, then round to the cent once',
        say: 'Round once, at the end. Rounding at every step can drift a cent or two.',
      },
    ],
    hook: 'Restaurant bills, shopping receipts and savings accounts.',
    graphHelps: 'A straight line for a tip or tax (amount against price); a curve bending upward for compound interest.',
    graph: { exprs: ['0.15x'], caption: 'A 15% tip is a straight line: tip = 0.15 × bill.', xRange: [0, 120], yRange: [0, 20], mark: [{ x: 84.5, y: 12.675, label: '$84.50 bill' }], say: 'Plot the bill across and the tip up. A fifteen percent tip is a straight line through zero, so a bill twice as big gets a tip twice as big.' },
    pattern: { see: 'a price with a tip, tax, discount or interest rate', think: 'turn each percent into a multiplier and multiply, rounding to the cent only at the end' },
    asking: 'What we are really asking is: what multiplier turns the price into what we pay?',
    bigIdea: 'Every percent on a price is a multiplier, so a chain of discounts, taxes and interest is just a chain of multiplications.',
    oneIdea: 'Turn each percent into a multiplier, and round to the cent at the end.',
    checkTip: 'Find 10% by moving the decimal point, then scale it; your exact answer should be close.',
    summary: ['Tip or tax = price × rate.', 'Total = price × (1 + rate).', 'Discounts multiply by (1 − rate).', 'Round to the cent once, at the end.'],
    subtopics: [
      { id: 'tip', name: 'Tips', phrases: /\btips?\b|gratuity/i, difficulties: [1], match: /tip/ },
      { id: 'tax-discount', name: 'Discounts and sales tax', phrases: /discount|sales tax|\btax\b|% off|sale price/i, difficulties: [2], match: /off, and sales tax/ },
      { id: 'split', name: 'Splitting a bill', phrases: /split(?:ting)? (?:a |the )?bill|split evenly/i, difficulties: [2], match: /split/ },
      {
        id: 'simple-interest',
        name: 'Simple interest',
        phrases: /simple interest/i,
        difficulties: [3],
        match: /simple interest/,
        rule: { heading: 'Simple interest', tex: 'I = Prt', say: 'Simple interest is the principal times the yearly rate, as a decimal, times the number of years. The interest never earns interest of its own.' },
      },
      {
        id: 'compound-interest',
        name: 'Compound interest',
        phrases: /compound interest|interest|compounded/i,
        difficulties: [3],
        match: /compounded/,
        rule: { heading: 'Compound interest', tex: 'A = P\\left(1 + \\frac{r}{n}\\right)^{nt}', say: 'Each period multiplies the balance by one plus the rate per period. Over n t periods, that is the formula.' },
      },
    ],
  },
};

/** Phrases that name a whole topic. Checked after subtopic phrases. */
const TOPIC_PHRASES: [RegExp, Topic][] = [
  [/order of operations|bodmas|pemdas|bidmas|arithmetic|mental math/i, 'arithmetic'],
  [/fraction|numerator|denominator|reciprocal|mixed numbers?/i, 'fractions'],
  [/percent|percentage|%/i, 'percent'],
  [/simultaneous|systems? of (?:linear )?equations|two equations|elimination|substitution method/i, 'system'],
  [/quadratic|parabola|factor(?:ing|ise|ize)|complet(?:e|ing) the square|discriminant|roots? of/i, 'quadratic'],
  [/linear|solving equations|solve for x|equations?|slope|gradient|straight line|algebra/i, 'linear'],
  [/exponent|indices|index laws?|powers?(?! rule)|scientific notation/i, 'exponents'],
  [/derivative|differentiat|chain rule|product rule|quotient rule|power rule|rate of change|tangent|calculus/i, 'derivative'],
  [/integra|antiderivative|area under|by parts|u[- ]?sub/i, 'integral'],
  [/unit|convert|conversion|metric|imperial|celsius|fahrenheit|temperature|kilomet|miles?/i, 'units'],
  [/stat|mean|median|mode|average|standard deviation|variance|range|data/i, 'stats'],
  [/geometr|area|volume|perimeter|circumference|pythag|hypotenuse|triangle|circle|rectangle|sphere|cylinder|cone|shape/i, 'geometry'],
  [/money|tip|tax|discount|interest|bill|price|budget|sale/i, 'money'],
];

const TOPIC_IDS = Object.keys(NOTES) as Topic[];

/** Resolves a topic phrase to a topic and, when named, a subtopic. */
export function resolve(phrase: string): { topic: Topic; sub?: Subtopic } | null {
  const p = phrase.trim().toLowerCase();
  if (!p) return null;
  if ((TOPIC_IDS as string[]).includes(p)) return { topic: p as Topic };
  // Subtopics are more specific than topics, so they win. A few need context to avoid clashes.
  // "power rule for integrals", "integrating with the power rule": integration wins whenever it is named.
  const integration = /integra|antideriv|∫/.test(p);
  const order: Topic[] = integration ? ['integral', 'derivative', 'quadratic', 'system', 'exponents', 'money', 'percent', 'units', 'stats', 'geometry', 'fractions', 'linear', 'arithmetic'] : ['derivative', 'integral', 'quadratic', 'system', 'exponents', 'money', 'percent', 'units', 'stats', 'geometry', 'fractions', 'linear', 'arithmetic'];
  for (const t of order) {
    for (const sub of NOTES[t].subtopics) {
      if (sub.phrases.test(p)) {
        // "power rule" alone means derivatives; with integration named, the integral subtopics were tried first.
        return { topic: t, sub };
      }
    }
  }
  for (const [re, t] of TOPIC_PHRASES) if (re.test(p)) return { topic: t };
  return null;
}

/** Does a generated question use this subtopic? */
export function questionMatches(q: Question, sub: Subtopic | undefined): boolean {
  if (!sub?.match) return true;
  const hay = `${q.prompt}\n${q.steps.map((s) => s.text).join('\n')}`;
  return sub.match.test(hay);
}
