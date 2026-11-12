export { answerReference } from './query';
export { MAYBE_REFERENCE } from './gate';
export { lookup, resolve, findEntities, propLabel, PROP_PHRASES, type Entity, type Fact, type Kind, type LookupResult, type Prop, type Resolved } from './lookup';

export { ELEMENTS, ELEMENT_SOURCE, type ElementInfo, type ElementCategory } from './data/elements';
export { COMPOUNDS, COMPOUND_SOURCE, type CompoundInfo } from './data/compounds';
export { BODIES, BODY_SOURCE, STAR_SOURCE, type BodyInfo } from './data/bodies';
export { COUNTRIES, COUNTRY_SOURCE, type CountryInfo } from './data/countries';
export { FOODS, FOOD_SOURCE, type FoodInfo } from './data/foods';
export { MATH_CONSTANTS, SEQUENCES, EXTRA_CONSTANTS, type MathConstant, type Sequence, type ExtraConstant } from './data/math';

// Lower-case aliases matching the task's naming.
export { ELEMENTS as elements } from './data/elements';
export { COMPOUNDS as compounds } from './data/compounds';
export { BODIES as bodies } from './data/bodies';
export { COUNTRIES as countries } from './data/countries';
export { FOODS as foods } from './data/foods';
export { MATH_CONSTANTS as mathConstants, SEQUENCES as sequences } from './data/math';
// The full physical-constant list (science-engine's plus the extras) lives in './physical', which pulls in the unit engine.
