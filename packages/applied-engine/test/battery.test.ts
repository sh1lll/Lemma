import { describe, expect, it } from 'vitest';
import { answerApplied } from '../src';

// [input, expected value | display substring | {need}] — references: Serway & Jewett (physics), Zumdahl (chemistry),
// Hibbeler (structures), Ogata (control), NIST/CODATA constants, WHO/Mifflin–St Jeor (medical); computed independently in Python.
type Exp = number | string | { need: RegExp };
const B: [string, Exp][] = [
  ['friction force coefficient 0.3 mass 10 kg', 29.43],
  ['block on a 30 degree incline with mu 0.2, acceleration', 3.2059],
  ['centripetal acceleration 10 m/s radius 5 m', 20],
  ['torque 20 N at 0.5 m', 10],
  ['moment of inertia of a solid disk mass 2 kg radius 0.5 m', 0.25],
  ['escape velocity of earth', 11186.17],
  ['surface gravity of mars', 3.72798],
  ['period of a pendulum 2 m long', 2.837],
  ['pressure at depth 10 m in water', 98100],
  ['heat to melt 1 kg of ice', 334000],
  ['carnot efficiency 500 K and 300 K', 0.4],
  ['doppler 500 Hz source approaching at 30 m/s', 547.923],
  ['beat frequency 440 Hz and 444 Hz', 4],
  ["snell's law n1 1.0 n2 1.5 angle 30 degrees", 19.4712],
  ['coulomb force 2 µC and 3 µC 0.1 m apart', 5.39253],
  ['RC time constant 10 kΩ 100 µF', 1],
  ['resonant frequency L 10 mH C 1 µF', 1591.549],
  ['time dilation at 0.8c for 10 s', 16.6667],
  ['photon energy 500 nm', 3.97289e-19],
  ['de Broglie wavelength electron 1e6 m/s', 7.2739e-10],
  ['hydrogen energy level n=2', -3.40142],
  ['carbon dating 25% remaining', 11460],
  ['pH of 0.01 M acetic acid Ka 1.8e-5', 3.3816],
  ['pKa of Ka 1.8e-5', 4.74473],
  ['first order half life k 0.01', 69.3147],
  ['cell potential zinc and copper', 1.1],
  ['percent yield actual 15 g theoretical 20 g', 75],
  ['empirical formula 40% C 6.7% H 53.3% O', 'CH₂O'],
  ['resistors 4, 6 and 12 ohm in parallel', 2],
  ['resistors 100, 220 and 330 Ω in series', 650],
  ['capacitive reactance 10 µF at 60 Hz', 265.258],
  ['otto cycle efficiency compression ratio 8', 0.564725],
  ['MTBF 1000 hours reliability at 100 hours', 0.904837],
  ['series reliability 0.9, 0.95, 0.99', 0.84645],
  ['Cp USL 10.5 LSL 9.5 sigma 0.1', 1.66667],
  ['transfer function 1/(s^2+3s+2) poles', 'Stable'],
  ["-5 in two's complement 8 bit", '1111 1011'],
  ['convert 192.168.1.0/26 to range', '192.168.1.0 – 192.168.1.63'],
  ['subnet mask for /20', '255.255.240.0'],
  ['0.1 as IEEE 754 single', '0x3DCCCCCD'],
  ['download 2 GB at 100 Mbps', 160],
  ["crc32 of 'hello'", '0x3610A686'],
  ["sha256 of 'abc'", 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ['7B params at fp16 memory', 14],
  ['training flops 7B params 2T tokens', 8.4e22],
  ['BMI 70 kg 1.75 m', 22.8571],
  ['BMR male 70 kg 175 cm 30 years', 1648.75],
  ['sensitivity 90% specificity 95% prevalence 2% PPV', 0.268657],
  ['herd immunity threshold R0 3', 0.666667],
  ['michaelis menten Vmax 10 Km 2 S 3', 6],
  ['ranked choice ballots: 5 A>B>C, 4 B>C>A, 3 C>B>A', 'B'],
  ['apportion 10 seats hamilton A 1500 B 3200 C 5300', 'A 2, B 3, C 5'],
  ['BMR 70 kg 175 cm 30 years', { need: /male or female/ }],
  ['elastic collision 2 kg at 3 m/s', { need: /both masses/ }],
];

describe('applied battery', () => {
  for (const [q, e] of B)
    it(q, () => {
      const r = answerApplied(q);
      expect(r, 'not recognised').not.toBeNull();
      if (typeof e === 'object') {
        expect(r!.ok).toBe(false);
        if (!r!.ok) expect(r!.error.message).toMatch(e.need);
        return;
      }
      if (!r!.ok) throw new Error(r!.error.message);
      if (typeof e === 'number') expect(Math.abs(r!.value!.toNumber() - e) / Math.max(Math.abs(e), 1e-30)).toBeLessThan(2e-3);
      else expect(r!.primary.display).toContain(e);
    });
  it('leaves plain arithmetic alone', () => {
    for (const q of ['2 + 2', 'work out 15% of 80', '20% of 450 + 30', '5 miles to km']) expect(answerApplied(q)).toBeNull();
  });
});
