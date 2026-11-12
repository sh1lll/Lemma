// Hand-written lesson scripts for the dev harness and e2e tests (the tutor engine will generate these).
import type { LessonScript } from './script-timeline';

/** Explain style: a linear equation, step by step with margin notes. */
export const equationScript: LessonScript = {
  title: 'Solving a linear equation',
  style: 'chalkboard',
  source: 'solve 2x + 3 = 11',
  kind: 'explain',
  scenes: [
    { kind: 'title', title: 'Solving 2x + 3 = 11', subtitle: 'Undo each operation, one at a time', say: "Let's solve two x plus three equals eleven." },
    { kind: 'problem', label: 'Solve for x', text: 'Find the value of x that makes this true:', tex: '2x + 3 = 11', say: 'We want the value of x that makes this equation true.' },
    { kind: 'step', text: 'Subtract 3 from both sides', tex: '2x + 3 - 3 = 11 - 3', why: 'undo the +3', say: 'First, subtract three from both sides to undo the plus three.' },
    { kind: 'step', text: 'Simplify', tex: '2x = 8', ink: 'accent', why: 'x is closer to alone', say: 'That leaves two x equals eight.' },
    { kind: 'step', text: 'Divide both sides by 2', tex: '\\frac{2x}{2} = \\frac{8}{2}', why: 'undo the ×2', say: 'Now divide both sides by two to undo the multiplication.' },
    { kind: 'step', text: 'Check: put x = 4 back in', tex: '2(4) + 3 = 11 \\checkmark', ink: 'third', why: 'always check', say: 'Check it: two times four plus three is eleven. It works.' },
    { kind: 'answer', display: 'x = 4', tex: 'x = 4', say: 'So x equals four.' },
  ],
};

/** Visual style: a parabola, its roots and its vertex. */
export const graphScript: LessonScript = {
  title: 'Where does a parabola cross the axis?',
  style: 'visual',
  source: 'graph y = x^2 - 4',
  kind: 'explain',
  scenes: [
    { kind: 'title', title: 'Reading roots from a graph', subtitle: 'y = x² − 4', say: "Let's see where a parabola crosses the x axis." },
    { kind: 'concept', heading: 'Roots are crossings', body: 'A root is an x where the graph meets the x-axis, so y is zero there.', tex: 'y = 0', say: 'A root is where the graph meets the x axis, so y is zero there.' },
    {
      kind: 'graph',
      exprs: ['x^2 - 4', '2x - 1'],
      xRange: [-4, 4],
      yRange: [-6, 8],
      mark: [
        { x: -2, y: 0, label: 'x = −2' },
        { x: 2, y: 0, label: 'x = 2' },
        { x: 0, y: -4, label: 'vertex (0, −4)' },
      ],
      caption: 'The curve dips to −4 and crosses the axis twice.',
      say: 'Watch the curve: it dips down to minus four, then crosses the axis at minus two and at two.',
    },
    { kind: 'step', text: 'Set y to zero', tex: 'x^2 - 4 = 0', why: 'roots: y = 0', say: 'To check, set y to zero.' },
    { kind: 'step', text: 'Factor the difference of squares', tex: '(x - 2)(x + 2) = 0', ink: 'accent', say: 'Factor it as a difference of squares.' },
    { kind: 'answer', display: 'x = −2 or x = 2', tex: 'x = -2 \\;\\text{or}\\; x = 2', say: 'So the roots are minus two and two, just as the graph showed.' },
  ],
};

/** Lecture style: the power rule with a rule, a mistake, a pause, a summary and practice. */
export const lectureScript: LessonScript = {
  title: 'The power rule',
  style: 'lecture',
  source: 'the power rule',
  kind: 'lecture',
  scenes: [
    { kind: 'title', title: 'The power rule', subtitle: 'Differentiating powers of x in one line', say: 'Today: the power rule, the fastest way to differentiate powers of x.' },
    { kind: 'rule', heading: 'The rule', tex: '\\frac{d}{dx}\\,x^n = n\\,x^{n-1}', note: 'Bring the power down, then lower it by one.', say: 'Bring the power down in front, then lower the power by one.' },
    { kind: 'problem', label: 'Example', text: 'Differentiate', tex: 'f(x) = x^5', say: "Let's use it on x to the fifth." },
    { kind: 'step', text: 'Bring the 5 down', tex: "f'(x) = 5\\,x^{5-1}", why: 'n = 5', say: 'Bring the five down in front.' },
    { kind: 'step', text: 'Lower the power by one', tex: "f'(x) = 5x^4", ink: 'accent', say: 'And lower the power by one: five x to the fourth.' },
    { kind: 'mistake', wrong: 'Lowering the power but forgetting to bring it down', wrongTex: "\\frac{d}{dx}x^5 = x^4", right: 'The old power multiplies in front', rightTex: '\\frac{d}{dx}x^5 = 5x^4', say: 'A common slip is forgetting the five in front. The old power always multiplies.' },
    { kind: 'pause', prompt: 'Differentiate x³ before the timer runs out.', seconds: 6, say: 'Your turn. Differentiate x cubed.' },
    { kind: 'summary', points: ['Multiply by the power', 'Subtract one from the power', 'Works for any real n'], say: 'In short: multiply by the power, subtract one, and it works for any real power.' },
    { kind: 'practice', text: 'Differentiate', tex: 'g(x) = x^{10}', answer: '10x⁹', say: 'Try this one: x to the tenth. The answer is ten x to the ninth.' },
  ],
};

export const SAMPLE_SCRIPTS: Record<string, LessonScript> = { equation: equationScript, graph: graphScript, lecture: lectureScript };
