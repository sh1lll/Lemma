export const FOOD_SOURCE = {
  name: 'USDA FoodData Central (SR Legacy), rounded',
  url: 'https://fdc.nal.usda.gov/',
  asOf: '2018',
};

export interface FoodInfo {
  name: string;
  /** What the figures describe, e.g. "raw, with skin". */
  form: string;
  aliases: string[];
  /** Per 100 g. */
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  fibre: number;
  sugar?: number;
  /** A typical serving: grams and a label ("medium apple"). */
  serving?: [number, string];
}

// name|form|aliases|kcal|protein|fat|carbs|fibre|sugar|serving g|serving label — all per 100 g.
const ROWS = [
  'Apple|raw, with skin|apples|52|0.26|0.17|13.81|2.4|10.39|182|medium apple',
  'Banana|raw|bananas|89|1.09|0.33|22.84|2.6|12.23|118|medium banana',
  'Orange|raw|oranges|47|0.94|0.12|11.75|2.4|9.35|131|medium orange',
  'Pear|raw|pears|57|0.36|0.14|15.23|3.1|9.75|178|medium pear',
  'Peach|raw|peaches|39|0.91|0.25|9.54|1.5|8.39|150|medium peach',
  'Grapes|raw|grape|69|0.72|0.16|18.10|0.9|15.48|151|cup',
  'Strawberries|raw|strawberry|32|0.67|0.30|7.68|2.0|4.89|152|cup, halved',
  'Blueberries|raw|blueberry|57|0.74|0.33|14.49|2.4|9.96|148|cup',
  'Raspberries|raw|raspberry|52|1.20|0.65|11.94|6.5|4.42|123|cup',
  'Watermelon|raw||30|0.61|0.15|7.55|0.4|6.20|152|cup, diced',
  'Pineapple|raw||50|0.54|0.12|13.12|1.4|9.85|165|cup, chunks',
  'Mango|raw|mangoes,mangos|60|0.82|0.38|14.98|1.6|13.66|165|cup, pieces',
  'Kiwi|raw|kiwifruit,kiwi fruit,kiwis|61|1.14|0.52|14.66|3.0|8.99|69|kiwi',
  'Lemon|raw, without peel|lemons|29|1.10|0.30|9.32|2.8|2.50|58|lemon',
  'Avocado|raw|avocados,avocadoes|160|2.00|14.66|8.53|6.7|0.66||',
  'Tomato|raw|tomatoes|18|0.88|0.20|3.89|1.2|2.63|123|medium tomato',
  'Broccoli|raw||34|2.82|0.37|6.64|2.6|1.70|91|cup, chopped',
  'Carrot|raw|carrots|41|0.93|0.24|9.58|2.8|4.74|61|medium carrot',
  'Spinach|raw||23|2.86|0.39|3.63|2.2|0.42|30|cup',
  'Cauliflower|raw||25|1.92|0.28|4.97|2.0|1.91|107|cup, chopped',
  'Cucumber|raw, with peel|cucumbers|15|0.65|0.11|3.63|0.5|1.67||',
  'Lettuce|iceberg, raw|iceberg lettuce|14|0.90|0.14|2.97|1.2|1.97||',
  'Onion|raw|onions|40|1.10|0.10|9.34|1.7|4.24|110|medium onion',
  'Garlic|raw||149|6.36|0.50|33.06|2.1|1.00|3|clove',
  'Red bell pepper|raw|bell pepper,red pepper,bell peppers|31|0.99|0.30|6.03|2.1|4.20|119|medium pepper',
  'Mushrooms|white, raw|mushroom,white mushrooms|22|3.09|0.34|3.26|1.0|1.98||',
  'Green peas|raw|peas,pea|81|5.42|0.40|14.45|5.1|5.67||',
  'Potato|boiled, without skin|potatoes,boiled potato|86|1.71|0.10|20.01|2.0|0.85||',
  'Baked potato|flesh and skin|baked potatoes|93|2.50|0.13|21.15|2.2|1.18|173|medium potato',
  'Sweet potato|baked in skin|sweet potatoes|90|2.01|0.15|20.71|3.3|6.48|114|medium sweet potato',
  'Egg|whole, raw|eggs,whole egg,raw egg|143|12.56|9.51|0.72|0|0.37|50|large egg',
  'Boiled egg|hard-boiled|hard boiled egg,boiled eggs,hard-boiled egg|155|12.58|10.61|1.12|0|1.12|50|large egg',
  'White rice|long-grain, cooked|rice,cooked rice,white rice cooked|130|2.69|0.28|28.17|0.4|0.05|158|cup',
  'Pasta|spaghetti, cooked|spaghetti,cooked pasta|158|5.80|0.93|30.86|1.8|0.56|140|cup',
  'Quinoa|cooked||120|4.40|1.92|21.30|2.8|0.87|185|cup',
  'Oats|dry|oat,rolled oats,oatmeal,porridge oats|389|16.89|6.90|66.27|10.6||40|half cup, dry',
  'White bread|commercially prepared|bread,white bread|266|7.64|3.29|50.61|2.4|5.34|25|slice',
  'Wheat flour|all-purpose, enriched|flour,all-purpose flour,plain flour|364|10.33|0.98|76.31|2.7|0.27|125|cup',
  'Popcorn|air-popped||387|12.94|4.54|77.78|14.5|0.87|8|cup',
  'Chicken breast|roasted, meat only|chicken,chicken breasts|165|31.02|3.57|0|0|0|85|3 oz serving',
  'Ground beef|80% lean, raw|beef,minced beef,hamburger meat,beef mince|254|17.17|20.00|0|0|0|85|3 oz serving',
  'Salmon|Atlantic, farmed, cooked||206|22.10|12.35|0|0|0|85|3 oz serving',
  'Tuna|light, canned in water, drained|canned tuna,tuna fish|116|25.51|0.82|0|0|0|85|3 oz serving',
  'Bacon|pan-fried||541|37.04|41.78|1.43|0|0||',
  'Tofu|raw, regular|bean curd|76|8.08|4.78|1.87|0.3|||',
  'Black beans|boiled|black bean|132|8.86|0.54|23.71|8.7|0.32|172|cup',
  'Lentils|boiled|lentil|116|9.02|0.38|20.13|7.9|1.80|198|cup',
  'Chickpeas|boiled|chickpea,garbanzo beans,garbanzos|164|8.86|2.59|27.42|7.6|4.80|164|cup',
  'Milk|whole, 3.25% fat|whole milk,cows milk,cow\'s milk|61|3.15|3.25|4.80|0|5.05|244|cup',
  'Skim milk|nonfat|skimmed milk,nonfat milk,fat free milk|34|3.37|0.08|4.96|0|5.09|245|cup',
  'Yogurt|plain, whole milk|yoghurt,plain yogurt,yogurts|61|3.47|3.25|4.66|0|4.66|245|cup',
  'Greek yogurt|plain, nonfat|greek yoghurt|59|10.19|0.39|3.60|0|3.24|170|container',
  'Cheddar|cheese|cheddar cheese,cheese|403|24.90|33.14|1.28|0|0.52|28|1 oz slice',
  'Mozzarella|whole milk|mozzarella cheese|300|22.17|22.35|2.19|0|1.03|28|1 oz',
  'Butter|salted||717|0.85|81.11|0.06|0|0.06|14|tablespoon',
  'Olive oil|||884|0|100|0|0|0|13.5|tablespoon',
  'Almonds|raw|almond|579|21.15|49.93|21.55|12.5|4.35|28|1 oz',
  'Walnuts|raw|walnut|654|15.23|65.21|13.71|6.7|2.61|28|1 oz',
  'Cashews|raw|cashew,cashew nuts|553|18.22|43.85|30.19|3.3|5.91|28|1 oz',
  'Peanuts|raw|peanut|567|25.80|49.24|16.13|8.5|4.72|28|1 oz',
  'Peanut butter|smooth||588|25.09|50.39|19.56|6.0|9.22|16|tablespoon',
  'Dark chocolate|70–85% cacao|dark chocolate bar|598|7.79|42.63|45.90|10.9|23.99|28|1 oz',
  'Milk chocolate||milk chocolate bar,chocolate|535|7.65|29.66|59.40|3.4|51.50||',
  'Sugar|granulated|white sugar,granulated sugar|387|0|0|99.98|0|99.80|4|teaspoon',
  'Honey|||304|0.30|0|82.40|0.2|82.12|21|tablespoon',
  'Orange juice|raw||45|0.70|0.20|10.40|0.2|8.40|248|cup',
  'Coffee|brewed|black coffee|1|0.12|0.02|0|0|0|237|cup',
  'Beer|regular||43|0.46|0|3.55|0|0|356|12 fl oz can',
];

export const FOODS: FoodInfo[] = ROWS.map((row) => {
  const [name = '', form = '', aliases = '', kcal, protein, fat, carbs, fibre, sugar, sg, sl] = row.split('|');
  const f: FoodInfo = {
    name,
    form,
    aliases: aliases.split(',').map((a) => a.trim()).filter(Boolean),
    kcal: Number(kcal),
    protein: Number(protein),
    fat: Number(fat),
    carbs: Number(carbs),
    fibre: Number(fibre),
  };
  if (sugar) f.sugar = Number(sugar);
  if (sg && sl) f.serving = [Number(sg), sl];
  return f;
});
