export const BODY_SOURCE = {
  name: 'NASA NSSDCA Planetary Fact Sheets',
  url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/',
  asOf: '2024',
};
export const STAR_SOURCE = {
  name: 'SIMBAD astronomical database and published stellar measurements',
  url: 'https://simbad.cds.unistra.fr/simbad/',
  asOf: '2024',
};

export interface BodyInfo {
  name: string;
  type: 'star' | 'planet' | 'dwarf planet' | 'moon';
  aliases: string[];
  /** kg, as a decimal string. */
  mass?: string;
  /** Mean (volumetric) radius, km. */
  radius?: number;
  /** Surface gravity, m/s² (at the 1 bar level for the giant planets). */
  gravity?: number;
  /** Mean density, kg/m³. */
  density?: number;
  /** Escape velocity, km/s. */
  escape?: number;
  /** Mean distance from the Sun, perihelion and aphelion: millions of km. */
  sunDist?: number;
  perihelion?: number;
  aphelion?: number;
  /** Distance from Earth: average, closest and farthest, millions of km (only where well established). */
  earthAvg?: number;
  earthMin?: number;
  earthMax?: number;
  /** Orbital period, Earth days. */
  period?: number;
  /** Length of the solar day, hours. */
  day?: number;
  /** Sidereal rotation period, hours (negative = retrograde). */
  rotation?: number;
  /** Mean surface temperature, °C. */
  temp?: number;
  /** Number of confirmed moons and the year of that count. */
  moons?: [number, number];
  /** Moons: the body orbited, the mean orbital distance from it (km). */
  parent?: string;
  parentDist?: number;
  perigee?: number;
  apogee?: number;
  /** Stars: distance from Earth in light years, spectral type, mass and radius in solar units, effective temperature K. */
  ly?: number;
  approxDistance?: boolean;
  spectral?: string;
  massSun?: number;
  radiusSun?: number;
  tempK?: number;
  constellation?: string;
  note?: string;
}

export const SUN_MASS = '1.9885e30';
export const SUN_RADIUS_KM = 695700;

// Planets, Pluto and the Moon: NASA's individual fact sheets (mass, volumetric mean radius, surface gravity) and the
// planetary fact sheet (distances, periods, mean temperatures, moon counts).
export const BODIES: BodyInfo[] = [
  {
    name: 'Sun', type: 'star', aliases: ['sun', 'the sun', 'sol', 'our sun'], mass: SUN_MASS, radius: SUN_RADIUS_KM, gravity: 274, density: 1408,
    escape: 617.6, rotation: 609.12, tempK: 5772, spectral: 'G2V', earthAvg: 149.598, earthMin: 147.1, earthMax: 152.1,
    note: 'Temperature is the effective (photosphere) temperature; the core is about 15 million K',
  },
  { name: 'Mercury', type: 'planet', aliases: ['mercury', 'planet mercury', 'the planet mercury'], mass: '3.3010e23', radius: 2439.7, gravity: 3.7, density: 5429, escape: 4.3, sunDist: 57.9, perihelion: 46.0, aphelion: 69.8, period: 88.0, day: 4222.6, rotation: 1407.6, temp: 167, moons: [0, 2024] },
  { name: 'Venus', type: 'planet', aliases: ['venus', 'planet venus'], mass: '4.8673e24', radius: 6051.8, gravity: 8.87, density: 5243, escape: 10.4, sunDist: 108.2, perihelion: 107.5, aphelion: 108.9, earthMin: 38, earthMax: 261, period: 224.7, day: 2802.0, rotation: -5832.5, temp: 464, moons: [0, 2024] },
  { name: 'Earth', type: 'planet', aliases: ['earth', 'the earth', 'planet earth'], mass: '5.9722e24', radius: 6371.0, gravity: 9.8, density: 5514, escape: 11.2, sunDist: 149.6, perihelion: 147.1, aphelion: 152.1, period: 365.2, day: 24.0, rotation: 23.9, temp: 15, moons: [1, 2024] },
  {
    name: 'Moon', type: 'moon', aliases: ['moon', 'the moon', 'luna', 'earths moon', "earth's moon", 'our moon'], mass: '7.346e22', radius: 1737.4, gravity: 1.62, density: 3344,
    escape: 2.38, parent: 'Earth', parentDist: 384400, perigee: 363300, apogee: 405500, period: 27.3, day: 708.7, rotation: 655.7, temp: -20,
    note: 'Surface temperature ranges from about −173 °C at night to 127 °C in sunlight',
  },
  { name: 'Mars', type: 'planet', aliases: ['mars', 'planet mars', 'the red planet'], mass: '6.4169e23', radius: 3389.5, gravity: 3.71, density: 3934, escape: 5.0, sunDist: 228.0, perihelion: 206.6, aphelion: 249.3, earthAvg: 225, earthMin: 54.6, earthMax: 401, period: 687.0, day: 24.7, rotation: 24.6, temp: -65, moons: [2, 2024] },
  { name: 'Jupiter', type: 'planet', aliases: ['jupiter', 'planet jupiter'], mass: '1.89813e27', radius: 69911, gravity: 24.79, density: 1326, escape: 59.5, sunDist: 778.5, perihelion: 740.6, aphelion: 816.4, earthMin: 588, earthMax: 968, period: 4331, day: 9.9, rotation: 9.9, temp: -110, moons: [95, 2024] },
  { name: 'Saturn', type: 'planet', aliases: ['saturn', 'planet saturn'], mass: '5.6832e26', radius: 58232, gravity: 10.44, density: 687, escape: 35.5, sunDist: 1432.0, perihelion: 1357.6, aphelion: 1506.5, period: 10747, day: 10.7, rotation: 10.7, temp: -140, moons: [274, 2025] },
  { name: 'Uranus', type: 'planet', aliases: ['uranus', 'planet uranus'], mass: '8.6811e25', radius: 25362, gravity: 8.87, density: 1270, escape: 21.3, sunDist: 2867.0, perihelion: 2732.7, aphelion: 3001.4, period: 30589, day: 17.2, rotation: -17.2, temp: -195, moons: [28, 2024] },
  { name: 'Neptune', type: 'planet', aliases: ['neptune', 'planet neptune'], mass: '1.02409e26', radius: 24622, gravity: 11.15, density: 1638, escape: 23.5, sunDist: 4515.0, perihelion: 4471.1, aphelion: 4558.9, period: 59800, day: 16.1, rotation: 16.1, temp: -200, moons: [16, 2024] },
  { name: 'Pluto', type: 'dwarf planet', aliases: ['pluto', 'dwarf planet pluto'], mass: '1.303e22', radius: 1188.3, gravity: 0.62, density: 1850, escape: 1.3, sunDist: 5906.4, perihelion: 4436.8, aphelion: 7375.9, period: 90560, day: 153.3, rotation: -153.3, temp: -225, moons: [5, 2024] },

  // Major moons: NASA/JPL planetary satellite physical and mean orbital parameters.
  { name: 'Io', type: 'moon', aliases: ['io'], parent: 'Jupiter', mass: '8.932e22', radius: 1821.6, gravity: 1.796, period: 1.769, parentDist: 421700 },
  { name: 'Europa', type: 'moon', aliases: ['europa'], parent: 'Jupiter', mass: '4.800e22', radius: 1560.8, gravity: 1.314, period: 3.551, parentDist: 671100 },
  { name: 'Ganymede', type: 'moon', aliases: ['ganymede'], parent: 'Jupiter', mass: '1.4819e23', radius: 2634.1, gravity: 1.428, period: 7.155, parentDist: 1070400, note: 'The largest moon in the Solar System' },
  { name: 'Callisto', type: 'moon', aliases: ['callisto'], parent: 'Jupiter', mass: '1.0759e23', radius: 2410.3, gravity: 1.235, period: 16.689, parentDist: 1882700 },
  { name: 'Titan', type: 'moon', aliases: ['titan'], parent: 'Saturn', mass: '1.3452e23', radius: 2574.7, gravity: 1.352, period: 15.945, parentDist: 1221870 },
  { name: 'Enceladus', type: 'moon', aliases: ['enceladus'], parent: 'Saturn', mass: '1.080e20', radius: 252.1, gravity: 0.113, period: 1.370, parentDist: 238040 },
  { name: 'Rhea', type: 'moon', aliases: ['rhea'], parent: 'Saturn', mass: '2.306e21', radius: 763.8, gravity: 0.264, period: 4.518, parentDist: 527108 },
  { name: 'Triton', type: 'moon', aliases: ['triton'], parent: 'Neptune', mass: '2.139e22', radius: 1353.4, gravity: 0.779, period: 5.877, parentDist: 354759, note: 'Orbits Neptune backwards (retrograde)' },
  { name: 'Phobos', type: 'moon', aliases: ['phobos'], parent: 'Mars', mass: '1.0659e16', radius: 11.08, period: 0.319, parentDist: 9376 },
  { name: 'Deimos', type: 'moon', aliases: ['deimos'], parent: 'Mars', mass: '1.4762e15', radius: 6.2, period: 1.263, parentDist: 23463 },
  { name: 'Charon', type: 'moon', aliases: ['charon'], parent: 'Pluto', mass: '1.586e21', radius: 606, gravity: 0.288, period: 6.387, parentDist: 19591 },

  // Stars. Distances in light years; values for distant supergiants are uncertain.
  { name: 'Proxima Centauri', type: 'star', aliases: ['proxima centauri', 'proxima', 'alpha centauri c'], ly: 4.2465, spectral: 'M5.5Ve', massSun: 0.122, radiusSun: 0.154, tempK: 3042, constellation: 'Centaurus', note: 'The nearest star to the Sun' },
  { name: 'Alpha Centauri A', type: 'star', aliases: ['alpha centauri', 'alpha centauri a', 'rigil kentaurus', 'rigil kent'], ly: 4.37, spectral: 'G2V', massSun: 1.08, radiusSun: 1.22, tempK: 5790, constellation: 'Centaurus' },
  { name: "Barnard's Star", type: 'star', aliases: ["barnard's star", 'barnards star', 'barnard star'], ly: 5.96, spectral: 'M4V', massSun: 0.162, radiusSun: 0.187, constellation: 'Ophiuchus' },
  { name: 'Sirius', type: 'star', aliases: ['sirius', 'sirius a', 'dog star', 'the dog star'], ly: 8.6, spectral: 'A1V', massSun: 2.06, radiusSun: 1.71, tempK: 9940, constellation: 'Canis Major', note: 'The brightest star in the night sky' },
  { name: 'Altair', type: 'star', aliases: ['altair'], ly: 16.73, spectral: 'A7V', massSun: 1.86, constellation: 'Aquila' },
  { name: 'Vega', type: 'star', aliases: ['vega'], ly: 25.04, spectral: 'A0V', massSun: 2.1, tempK: 9600, constellation: 'Lyra' },
  { name: 'Arcturus', type: 'star', aliases: ['arcturus'], ly: 36.7, spectral: 'K1.5III', massSun: 1.08, radiusSun: 25.4, tempK: 4286, constellation: 'Boötes' },
  { name: 'Aldebaran', type: 'star', aliases: ['aldebaran'], ly: 65, spectral: 'K5III', tempK: 3900, constellation: 'Taurus', approxDistance: true },
  { name: 'Canopus', type: 'star', aliases: ['canopus'], ly: 310, spectral: 'A9II', massSun: 8, radiusSun: 71, constellation: 'Carina', approxDistance: true },
  { name: 'Polaris', type: 'star', aliases: ['polaris', 'north star', 'the north star', 'pole star', 'the pole star'], ly: 433, spectral: 'F7Ib', massSun: 5.4, radiusSun: 37.5, tempK: 6015, constellation: 'Ursa Minor', approxDistance: true },
  { name: 'Betelgeuse', type: 'star', aliases: ['betelgeuse'], ly: 550, spectral: 'M1–M2 Ia', tempK: 3600, constellation: 'Orion', approxDistance: true, note: 'A red supergiant; its distance and size are uncertain' },
  { name: 'Antares', type: 'star', aliases: ['antares'], ly: 550, spectral: 'M1.5Iab', constellation: 'Scorpius', approxDistance: true, note: 'A red supergiant; its distance is uncertain' },
  { name: 'Rigel', type: 'star', aliases: ['rigel'], ly: 860, spectral: 'B8Ia', massSun: 21, radiusSun: 79, tempK: 12100, constellation: 'Orion', approxDistance: true },
];
