// Reference battery for the discrete/applied engine. Each expected value is a textbook or published result:
// Burden & Faires (Numerical Analysis), Chvátal (Linear Programming), CLRS, Taha (Operations Research),
// Cover & Thomas (Information Theory), Wikipedia worked examples (Hamming, CRC, RFC 1071, Adler-32, Luhn, ISBN,
// Vigenère, affine, RSA, Diffie–Hellman), FIPS 180-4 (SHA-256), Radziszowski (Ramsey numbers).
import { describe, expect, it } from 'vitest';
import { answerDiscrete } from '../src';

function ok(q: string) {
  const r = answerDiscrete(q);
  if (!r) throw new Error(`not recognised: ${q}`);
  if (!r.ok) throw new Error(`failed: ${q}: ${r.error.message}`);
  return r;
}

const CASES: [string, string | RegExp][] = [
  // Root finding (Wallis's x³ − 2x − 5; √2; Dottie number)
  ["newton's method x^3 - 2x - 5 starting at 2", /2\.0945514/],
  ['bisection x^2 - 2 on [1, 2]', /1\.41421/],
  ['secant method cos x - x x0 = 0 x1 = 1', /0\.73908513/],
  ['fixed point iteration g(x) = cos x starting at 1', /0\.73908513/],
  // Quadrature
  ["simpson's rule integrate sin x from 0 to pi n=6", /2\.000863/],
  ['trapezoidal rule integral of x^2 from 0 to 1 n = 4', '≈ 0.34375'],
  ['gaussian quadrature e^x from 0 to 1 n=3', /1\.718281/],
  ['romberg integration 1/x from 1 to 2', /0\.69314/],
  // ODEs: y' = x + y, y(0) = 1 (exact 2e^x − x − 1)
  ["euler's method y' = x + y, y(0) = 1, h = 0.1, to x = 0.5", /1\.72102/],
  ['rk4 dy/dx = x + y, y(0)=1, h=0.1 to x=0.5', /1\.7974412/],
  // Interpolation
  ['lagrange interpolation (1,1),(2,4),(3,9) at x=2.5', '6.25'],
  ['cubic spline (0,0),(1,1),(2,8) at 1.5', '3.9375'],
  ['numerical derivative of sin x at 1 with h = 0.1', /0\.5394022/],
  // Iterative linear algebra
  ['gauss-seidel 10x - y + 2z = 6, -x + 11y - z = 25, 2x - y + 10z = -11', /x ≈ 1\.04326/],
  ['jacobi 4x - y = 3, -x + 4y = 3', /x ≈ 0\.99999/],
  ['power method [[2,1],[1,3]]', /3\.6180339/],
  // Floating point
  ['ieee 754 of 0.1', /^0 01111111011/],
  ['0.1 in single precision', '0 01111011 10011001100110011001101'],
  ['machine epsilon', '2^−52 ≈ 2.220446e-16'],
  ['condition number of [[1,2],[3,4]]', /14\.933/],
  ['rounding error 0.1 + 0.2', '0.30000000000000004'],
  ['relative error of 3.14 approximating pi', /0\.000507/],
  // Optimization
  ['maximize 3x + 2y subject to x + y <= 4, x + 3y <= 6, x,y >= 0', /max = 12 at \(x, y\) = \(4, 0\)/],
  ['minimize 2x + 3y subject to x + y >= 4, x + 3y >= 6', /min = 9 at \(x, y\) = \(3, 1\)/],
  ['maximize 5x1 + 4x2 + 3x3 subject to 2x1 + 3x2 + x3 <= 5, 4x1 + x2 + 2x3 <= 11, 3x1 + 4x2 + 2x3 <= 8', /max = 13 at .*\(2, 0, 1\)/],
  ['maximize 5x + 8y subject to x + y <= 6, 5x + 9y <= 45, x, y integer', /max = 40/],
  ['maximize xy subject to x + y = 10', /max = 25 at \(5, 5\)/],
  ['minimize x^2 + y^2 subject to x + y >= 1', /min = 0\.5/],
  ['transportation supply 20 30 25 demand 10 25 40 costs [[8,6,10],[9,12,13],[14,9,16]]', 'min cost = 775'],
  ['hungarian [[9,2,7,8],[6,4,3,7],[5,8,1,8],[7,6,9,4]]', 'min total = 13'],
  ['knapsack capacity 50 weights 10 20 30 values 60 100 120', 'max value = 220'],
  ['tsp A-B 10, A-C 15, A-D 20, B-C 35, B-D 25, C-D 30', '80'],
  ['coin change 11 with coins 1 2 5', '3 coins'],
  ['lcs ABCBDAB BDCABA', /^4 /],
  ['edit distance kitten sitting', '3'],
  ['M/M/1 lambda=4 mu=5', 'L = 4, W = 1'],
  ['M/M/3 λ=10 μ=4', /L = 6\.0112/],
  ['EPQ D=10000 S=100 H=2 production rate 40000', /1154\.70/],
  ['decision table [[200,100,-20],[90,50,10],[40,30,30]] probabilities 0.3 0.5 0.2', /EMV 106/],
  ['zero-sum game [[3,-1],[-2,4]]', 'value = 1'],
  ["nash equilibrium prisoner's dilemma", '1 Nash equilibrium'],
  ['gradient descent x^2 starting at 4 learning rate 0.25 5 iterations', /\(0\.125\)/],
  ["newton's method minimize f(x) = x^4 - 3x^3 + 2 from 3", /\(2\.25\)/],
  // Graphs
  ['shortest path from A to D: A-B 4, A-C 2, C-B 1, B-D 5, C-D 8', '8'],
  ['minimum spanning tree A-B 4, A-C 2, B-C 1, B-D 5, C-D 8, D-E 3', 'total weight 11'],
  ['max flow from s to t: s->a 10, s->b 5, a->b 15, a->t 10, b->t 10', '15'],
  ['bfs from A: A-B, A-C, B-D, C-D, D-E', 'A, B, C, D, E'],
  ['dfs from A: A-B, A-C, B-D, C-D, D-E', 'A, B, D, C, E'],
  ['chromatic number of the petersen graph', 'χ = 3'],
  ['is K5 planar', 'not planar'],
  ['is K3,3 planar', 'not planar'],
  ['is the petersen graph planar', 'not planar'],
  ['is Q3 planar', 'planar'],
  ['maximum matching K3,3', '3 pairs'],
  ['number of spanning trees of K4', '16'],
  ['bellman-ford from A: A->B 4, A->C 5, B->C -3, C->D 2', /distances from A/],
  ['topological sort A->B, A->C, B->D, C->D', 'A, B, C, D'],
  // Information & coding
  ['entropy of 0.5 0.25 0.25', '1.5 bits'],
  ['mutual information [[0.25,0.25],[0,0.5]]', /0\.311278/],
  ['capacity of bsc p=0.1', /0\.531004/],
  ['shannon capacity bandwidth 3 kHz snr 30 dB', /29901\.6/],
  ['huffman code for a:45 b:13 c:12 d:16 e:9 f:5', 'average 2.24 bits/symbol'],
  ['hamming encode 1011', '0110011'],
  ['hamming decode 0110111', /error at bit 5/],
  ['crc of 11010011101100 with generator 1011', 'remainder 100'],
  ['crc-32 of "123456789"', '0xCBF43926'],
  ['internet checksum 4500 0073 0000 4000 4011 0000 c0a8 0001 c0a8 00c7', '0xB861'],
  ['adler-32 of "Wikipedia"', '0x11E60398'],
  ['luhn 79927398713', 'valid'],
  ['isbn 0-306-40615-2', 'valid'],
  ['isbn 978-0-306-40615-7', 'valid'],
  // Cryptography
  ['caesar encrypt HELLO shift 3', 'KHOOR'],
  ['rot13 Hello', 'Uryyb'],
  ['vigenere encrypt ATTACKATDAWN key LEMON', 'LXFOPVEFRNHR'],
  ['affine encrypt AFFINE CIPHER a=5 b=8', 'IHHWVC SWFRCP'],
  ['modular exponentiation 3^200 mod 13', '9'],
  ['rsa p=61 q=53 e=17 encrypt 65', 'ciphertext 2790'],
  ['rsa p=61 q=53 e=17 decrypt 2790', 'message 65'],
  ['diffie hellman p=23 g=5 a=6 b=15', 'shared secret 2'],
  ['discrete log 3^x = 13 mod 17', 'x = 4'],
  ['sha256 of "abc"', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  // Signals
  ['dft of 1 0 -1 0', '[0, 2, 0, 2]'],
  ['convolve 1 2 3 with 0 1 0.5', '[0, 1, 2.5, 4, 1.5]'],
  ['moving average of 1 2 3 4 5 6 window 3', '[2, 3, 4, 5]'],
  ['fir filter coefficients 0.25 0.5 0.25 input 1 2 3 4', '[0.25, 1, 2, 3]'],
  ['alias frequency of 7 kHz sampled at 10 kHz', 'aliases to 3 kHz'],
  ['power ratio 100 to db', '20 dB'],
  // Quantum
  ['hadamard on |0>', '1/√2|0⟩ + 1/√2|1⟩'],
  ['H then CNOT on |00>', '1/√2|00⟩ + 1/√2|11⟩'],
  ['measure 0.6|0> + 0.8|1>', /P\(0\) = 0\.36, P\(1\) = 0\.64/],
  // Models, chaos, misc
  ['sir model beta 0.3 gamma 0.1 N 1000 I0 1', /peak 300\.\d+ infected/],
  ['logistic growth r=0.1 K=1000 P0=10 t=50', /599\.85/],
  ['logistic map r=3.2 x0=0.5', /period-2 cycle: 0\.799455, 0\.513045/],
  ['is -1 + 0i in the mandelbrot set', 'in the set (bounded)'],
  ['fractal dimension of the koch curve', /1\.26185/],
  ['T(n) = 2T(n/2) + n', 'T(n) = Θ(n log n)'],
  ['T(n) = 7T(n/2) + n^2', /Θ\(n\^2\.807/],
  ['euler characteristic of a torus', 'χ = 0'],
  ['euler characteristic V=8 E=12 F=6', 'χ = 2'],
  ['ramsey number R(3,3)', '6'],
  ['ramsey number R(4,5)', '25'],
  ['nim 3 4 5', /take 2 from heap 1/],
  ['nim 1 2 3', /second player wins/],
  ['fuzzy and 0.7 0.4', '0.4'],
  ['trefoil knot', 'crossing number 3'],
  ['compare big O: n log n, n^2, 2^n, log n', 'O(log n) < O(n log n) < O(n^2) < O(2^n)'],
  ['what is entropy', 'Entropy'],
  ['what is category theory', 'Category theory'],
];

describe('discrete engine battery', () => {
  it.each(CASES)('%s', (q, want) => {
    const d = ok(q).primary.display;
    if (typeof want === 'string') expect(d).toBe(want);
    else expect(d).toMatch(want);
  });

  it('leaves plain arithmetic and unrelated questions alone', () => {
    for (const q of ['2 + 2', 'what is 5 times 3', 'days until christmas', '50 miles to km']) expect(answerDiscrete(q)).toBeNull();
  });

  it('refuses impossible inputs with a message', () => {
    const r = answerDiscrete('bisection x^2 + 1 on [0, 1]');
    expect(r && !r.ok && r.error.message).toMatch(/same sign/);
  });
});
