/**
 * Extra per-topic material for the beginner, proof and story styles: plain definitions of terms, an
 * everyday analogy, a "where this breaks" note, and an original real-world scenario.
 */
import type { Topic } from '@lemma/practice-engine';

export interface Extras {
  /** Terms a newcomer needs, defined in plain words. */
  terms: { term: string; meaning: string }[];
  analogy: string;
  breaks: { text: string; tex?: string; say: string };
  story: {
    /** The curious situation, no numbers (the problem supplies those). */
    setup: string;
    /** Turns the situation into the math question. */
    bridge: string;
    /** Answers the story in plain words; {answer} is replaced with the verified answer. */
    close: string;
  };
  /** An easy understanding check for beginners, with its answer. */
  easyCheck: { prompt: string; answer: string };
}

export const EXTRAS: Record<Topic, Extras> = {
  arithmetic: {
    terms: [
      { term: 'expression', meaning: 'a calculation written out, like 3 + 2 × 4' },
      { term: 'operation', meaning: 'one action: adding, subtracting, multiplying, dividing or raising to a power' },
    ],
    analogy: 'It is like getting dressed: socks go on before shoes. Do it in the other order and you get a different, odder result.',
    breaks: { text: 'The order is a convention for written expressions. Something like 6 ÷ 2(1 + 2) is read differently by different calculators, so brackets beat relying on the rule.', tex: '6 \\div 2(1 + 2)', say: 'The order is a convention, not a law of nature. An expression like six divided by two, times one plus two, is read differently by different calculators. When it matters, add brackets.' },
    story: {
      setup: 'Two friends type the same line into two different calculators and get two different totals. Both are sure their calculator is right.',
      bridge: 'Only one reading follows the agreed order, so let us work it out by hand.',
      close: 'So the calculator that follows the agreed order shows {answer}.',
    },
    easyCheck: { prompt: 'Quick one: in 2 + 3 × 10, which do you do first?', answer: 'The multiplication: 3 × 10 = 30, then 2 + 30 = 32.' },
  },
  fractions: {
    terms: [
      { term: 'numerator', meaning: 'the top number: how many pieces you have' },
      { term: 'denominator', meaning: 'the bottom number: how many equal pieces the whole was cut into' },
      { term: 'common denominator', meaning: 'a bottom number both fractions can share, so the pieces are the same size' },
    ],
    analogy: 'Think of pizza. Half a pizza and a third of a pizza are different-sized slices; to count them together, recut both pizzas into sixths.',
    breaks: { text: 'A denominator can never be zero: cutting a whole into zero pieces means nothing. And fractions of different wholes, like half of a small pizza and half of a large one, cannot simply be added.', tex: '\\frac{a}{0}\\ \\text{is undefined}', say: 'A denominator can never be zero, because cutting something into zero pieces means nothing. And the rules assume both fractions are of the same whole.' },
    story: {
      setup: 'A baker is combining leftover amounts from two recipes, and the amounts on the cards are fractions.',
      bridge: 'Before measuring anything out, the baker wants to know what the combined amount really is.',
      close: 'So the baker’s amount works out to {answer}.',
    },
    easyCheck: { prompt: 'Easy check: which is bigger, 1/2 or 1/4?', answer: '1/2: cutting into fewer pieces makes each piece bigger.' },
  },
  percent: {
    terms: [
      { term: 'percent', meaning: 'out of one hundred; 20% means 20 out of every 100' },
      { term: 'decimal', meaning: 'the same amount written with a point, like 0.2 for 20%' },
    ],
    analogy: 'A percent is like a recipe for any batch size: “20 out of every 100” works whether you have 100 things or 450.',
    breaks: { text: 'Percents only combine when they are of the same amount. 50% of one bill plus 50% of another is not 100% of anything.', say: 'Percents only add up when they are percents of the same amount. Half of one bill plus half of another is not one whole of anything.' },
    story: {
      setup: 'A shop window has a big percent on the sign, and you want to know what it means in real money before you reach the till.',
      bridge: 'A percent on its own is not an amount yet, so let us turn it into one.',
      close: 'So the number behind the sign is {answer}.',
    },
    easyCheck: { prompt: 'Easy check: what is 50% of 10?', answer: '5, because 50% is a half.' },
  },
  linear: {
    terms: [
      { term: 'variable', meaning: 'a letter, usually x, standing for a number we do not know yet' },
      { term: 'equation', meaning: 'a statement that two amounts are equal, with an equals sign between them' },
      { term: 'coefficient', meaning: 'the number multiplying x, like the 2 in 2x' },
    ],
    analogy: 'An equation is a see-saw that is perfectly level. Take the same weight off both ends and it stays level.',
    breaks: { text: 'If the x terms cancel, there may be no solution (like 3 = 5) or every number works (like 0 = 0). And you can never divide both sides by zero.', tex: '0x = 2\\ \\text{has no solution}', say: 'If the x terms cancel out, you are left with either something false, so there is no solution, or something always true, so every number works. And you may never divide both sides by zero.' },
    story: {
      setup: 'A delivery rider is paid a fixed amount plus a set rate for each drop, and wants to know exactly how many drops reach a target.',
      bridge: 'One unknown number, one balance: that is a linear equation.',
      close: 'So the unknown number in the story is {answer}.',
    },
    easyCheck: { prompt: 'Easy check: if x + 2 = 5, what is x?', answer: 'x = 3, because 3 + 2 = 5.' },
  },
  quadratic: {
    terms: [
      { term: 'quadratic', meaning: 'an expression whose highest power of x is x squared' },
      { term: 'factor', meaning: 'to rewrite something as a multiplication of simpler pieces' },
      { term: 'root', meaning: 'a value of x that makes the expression equal zero' },
    ],
    analogy: 'If two numbers multiply to make zero, one of them has to be zero, just as a rectangle with zero area must have a side of length zero.',
    breaks: { text: 'If b² − 4ac is negative, there is no real square root, so there are no real solutions. And if a = 0 it is not a quadratic at all: the formula would divide by zero.', tex: 'b^2 - 4ac < 0 \\Rightarrow \\text{no real roots}', say: 'If b squared minus four a c is negative, the square root has no real value and the curve never touches the axis. And if a is zero, the formula divides by zero, because it was never a quadratic.' },
    story: {
      setup: 'A ball is tossed into the air. Its height follows a curve, and we want the moments when that curve sits exactly at zero.',
      bridge: 'A curve with an x squared in it is a quadratic, so the question becomes: where is it zero?',
      close: 'So the curve reaches zero at {answer}.',
    },
    easyCheck: { prompt: 'Easy check: if (x − 3)(x + 1) = 0, name one solution.', answer: 'x = 3 (or x = −1): one bracket has to be zero.' },
  },
  system: {
    terms: [
      { term: 'system', meaning: 'two equations that must both be true at the same time' },
      { term: 'eliminate', meaning: 'make one letter disappear by adding or subtracting the equations' },
    ],
    analogy: 'Two receipts from the same café, with different orders, are enough to work out each item’s price.',
    breaks: { text: 'If the two lines are parallel there is no solution; if they are the same line there are infinitely many. Elimination then gives 0 = (non-zero) or 0 = 0.', tex: '0 = 5\\ \\text{(none)},\\quad 0 = 0\\ \\text{(infinitely many)}', say: 'If the two lines are parallel they never meet, so there is no solution. If they are the same line, every point on it works. You will spot both when the variables all cancel.' },
    story: {
      setup: 'Two receipts from the same café list different mixes of the same two items, but neither shows the individual prices.',
      bridge: 'Each receipt is an equation, and the prices are the two unknowns.',
      close: 'So the two unknowns are {answer}.',
    },
    easyCheck: { prompt: 'Easy check: if x + y = 10 and x = 4, what is y?', answer: 'y = 6.' },
  },
  exponents: {
    terms: [
      { term: 'base', meaning: 'the number or letter being multiplied, like x in x³' },
      { term: 'exponent', meaning: 'the small raised number counting how many copies, like the 3 in x³' },
    ],
    analogy: 'An exponent is a stack of identical blocks. Put a stack of 3 next to a stack of 2 and you have a stack of 5.',
    breaks: { text: 'The rules need the same base: x² · y³ cannot be combined. And 0 raised to a negative power is undefined, because it means dividing by zero.', tex: 'x^2 y^3\\ \\text{stays as it is}', say: 'The rules only work for the same base: x squared times y cubed cannot be squashed together. And zero to a negative power means dividing by zero, which is undefined.' },
    story: {
      setup: 'A message is forwarded, and each round multiplies the number of copies by the same amount. Writing every multiplication out would take pages.',
      bridge: 'Exponents are the shorthand for that kind of repeated multiplication, so let us count copies.',
      close: 'Counting the copies, it simplifies to {answer}.',
    },
    easyCheck: { prompt: 'Easy check: what is 2³?', answer: '8, because 2 × 2 × 2 = 8.' },
  },
  derivative: {
    terms: [
      { term: 'function', meaning: 'a rule that turns an input x into an output' },
      { term: 'slope', meaning: 'how steep a line is: how much it goes up for each step across' },
      { term: 'derivative', meaning: 'the slope of a curve at each point, its rate of change' },
    ],
    analogy: 'A speedometer shows how fast your distance is changing right now. A derivative is a speedometer for any function.',
    breaks: { text: 'The power rule needs a fixed power: it does not apply to 2ˣ or xˣ. And at a sharp corner, like |x| at 0, there is no single slope, so no derivative.', tex: '\\frac{d}{dx}2^x \\ne x\\,2^{x-1}', say: 'The power rule needs the power to be a fixed number. It fails for two to the x. And at a sharp corner, like the absolute value graph at zero, there is no single slope, so no derivative there.' },
    story: {
      setup: 'A dashboard needs to show how fast a quantity is changing at one exact instant, not on average over an hour.',
      bridge: 'A rate at a single instant is a derivative.',
      close: 'So the rate of change at any point is {answer}.',
    },
    easyCheck: { prompt: 'Easy check: what is the slope of the line y = 3x?', answer: '3: it goes up 3 for every 1 across.' },
  },
  integral: {
    terms: [
      { term: 'integral', meaning: 'the reverse of a derivative, or the total area under a curve' },
      { term: 'antiderivative', meaning: 'a function whose derivative is the one you started with' },
      { term: 'constant of integration', meaning: 'the + C, because any constant disappears when you differentiate' },
    ],
    analogy: 'If a derivative is the speedometer, the integral is the trip counter: it adds up all the little bits of distance.',
    breaks: { text: 'The power rule fails at n = −1 because you would divide by zero: ∫ 1/x dx = ln|x| + C instead. Curves that shoot off to infinity inside the limits need extra care.', tex: '\\int \\frac{1}{x}\\,dx = \\ln|x| + C', say: 'The power rule breaks for x to the negative one, because you would divide by zero. That integral is the natural log of x instead. And if the curve shoots off to infinity between the limits, the simple method no longer applies.' },
    story: {
      setup: 'A tank fills at a rate that keeps changing, and someone needs the total amount that went in.',
      bridge: 'Adding up a changing rate is exactly what an integral does.',
      close: 'So the accumulated total is {answer}.',
    },
    easyCheck: { prompt: 'Easy check: which function has derivative 2x?', answer: 'x² (plus any constant).' },
  },
  units: {
    terms: [
      { term: 'unit', meaning: 'the label on a measurement, like meters or pounds' },
      { term: 'conversion factor', meaning: 'a fraction equal to one that swaps one unit for another' },
    ],
    analogy: 'It is like changing money: the value stays the same, only the kind of notes in your hand changes.',
    breaks: { text: 'Temperature scales start at different zeros, so you cannot just multiply: Fahrenheit to Celsius needs subtracting 32 first.', tex: 'C = \\tfrac{5}{9}(F - 32)', say: 'Temperature is the exception. The scales start at different zeros, so a single multiplier is not enough. Fahrenheit to Celsius needs you to subtract thirty-two first.' },
    story: {
      setup: 'A traveller reads a sign written in units they never use at home and has to decide quickly whether it is a lot or a little.',
      bridge: 'Same amount, different label: a conversion.',
      close: 'So in the other units it is {answer}.',
    },
    easyCheck: { prompt: 'Easy check: how many centimeters are in 2 meters?', answer: '200.' },
  },
  stats: {
    terms: [
      { term: 'data', meaning: 'the list of numbers you collected' },
      { term: 'mean', meaning: 'the total shared out equally' },
      { term: 'median', meaning: 'the middle value once the list is in order' },
    ],
    analogy: 'The mean is what everyone would get if all the sweets in a jar were shared out equally.',
    breaks: { text: 'The mean is dragged around by one extreme value; the median is not. And a sample standard deviation divides by n − 1, not n.', say: 'One extreme value can drag the mean a long way, while the median barely moves. And if your data is a sample rather than the whole population, the standard deviation divides by n minus one.' },
    story: {
      setup: 'Two teams both claim the better scores, and each is quoting whichever single result suits them best.',
      bridge: 'A fair comparison needs one number that sums up all the data.',
      close: 'So the number that sums up this data is {answer}.',
    },
    easyCheck: { prompt: 'Easy check: what is the middle number of 1, 5, 9?', answer: '5.' },
  },
  geometry: {
    terms: [
      { term: 'area', meaning: 'how much flat space a shape covers, in square units' },
      { term: 'right triangle', meaning: 'a triangle with one square corner' },
      { term: 'hypotenuse', meaning: 'the longest side of a right triangle, opposite the square corner' },
    ],
    analogy: 'Area is like counting floor tiles: a 6 by 5 room needs 6 rows of 5 tiles.',
    breaks: { text: 'Pythagoras only works for right triangles; any other triangle needs the law of cosines. Area and volume formulas assume flat, regular shapes.', tex: 'c^2 = a^2 + b^2 - 2ab\\cos C', say: 'The Pythagorean theorem only holds when there is a right angle. For other triangles there is a correction term, the law of cosines.' },
    story: {
      setup: 'Someone is about to buy materials for a room or a garden and does not want to pay for too much, or run out halfway.',
      bridge: 'The measurement they need comes from a standard formula.',
      close: 'So the measurement we needed is {answer}.',
    },
    easyCheck: { prompt: 'Easy check: what is the area of a 2 by 3 rectangle?', answer: '6 square units.' },
  },
  money: {
    terms: [
      { term: 'tip', meaning: 'extra money for service, worked out as a percent of the bill' },
      { term: 'rate', meaning: 'the percent written as a decimal, like 0.15 for 15%' },
    ],
    analogy: 'Adding 20% is like ordering one and a fifth of everything: multiply the bill by 1.2.',
    breaks: { text: 'Percent changes do not simply add or cancel, and the compound interest formula assumes the rate never changes. Rounding at every step can drift a cent or two.', say: 'Percent changes do not cancel each other out, and the interest formula assumes the rate stays the same the whole time. Round only at the end, or you can drift a cent or two.' },
    story: {
      setup: 'At the end of a meal the bill arrives, and suddenly everyone is very interested in their phone.',
      bridge: 'Someone has to do the percent math, so let us do it properly.',
      close: 'So the amount in question is {answer}.',
    },
    easyCheck: { prompt: 'Easy check: what is 10% of $50?', answer: '$5.' },
  },
};
