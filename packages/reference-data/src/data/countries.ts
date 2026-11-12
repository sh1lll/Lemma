export const COUNTRY_SOURCE = {
  name: 'World Bank World Development Indicators; UN World Population Prospects',
  url: 'https://data.worldbank.org/',
  asOf: '2023',
};

export interface CountryInfo {
  name: string;
  aliases: string[];
  capital: string;
  capitalNote?: string;
  /** Mid-2023 estimate. */
  population: number;
  populationYear: number;
  /** Total area, km². */
  area?: number;
  /** Nominal GDP, current US dollars. */
  gdp?: number;
  gdpYear?: number;
  gdpSource?: string;
  note?: string;
}

// name|aliases|capital|population (millions, 2023)|area km²|GDP (billion US$, 2023, World Bank unless noted)|capital note
// GDP is left blank where recent official figures are missing or unreliable.
const ROWS = [
  'China|prc,peoples republic of china,people\'s republic of china|Beijing|1410.7|9596961|17795|',
  'India|republic of india,bharat|New Delhi|1428.6|3287263|3550|',
  'United States|usa,us,u.s.,u.s.a.,united states of america,america,the us,the usa,the united states|Washington, D.C.|334.9|9833520|27361|',
  'Indonesia||Jakarta|277.5|1904569|1371|A new capital, Nusantara, is under construction',
  'Pakistan||Islamabad|240.5|881913|338|',
  'Nigeria||Abuja|223.8|923768|363|',
  'Brazil|brasil|Brasília|216.4|8515767|2174|',
  'Bangladesh||Dhaka|172.9|148460|437|',
  'Russia|russian federation|Moscow|144.4|17098246|2021|',
  'Mexico||Mexico City|128.5|1964375|1789|',
  'Ethiopia||Addis Ababa|126.5|1104300|164|',
  'Japan|nippon|Tokyo|124.5|377975|4213|',
  'Philippines|the philippines|Manila|117.3|300000|437|',
  'Egypt||Cairo|112.7|1002450|396|',
  'DR Congo|democratic republic of the congo,democratic republic of congo,drc,congo-kinshasa|Kinshasa|102.3|2344858|66|',
  'Vietnam|viet nam|Hanoi|98.9|331212|430|',
  'Iran|islamic republic of iran,persia|Tehran|89.2|1648195||',
  'Turkey|türkiye,turkiye|Ankara|85.3|783562|1108|',
  'Germany|deutschland|Berlin|84.5|357592|4456|',
  'Thailand|siam|Bangkok|71.8|513120|515|',
  'United Kingdom|uk,u.k.,britain,great britain,the uk,united kingdom of great britain and northern ireland|London|68.3|242495|3340|',
  'France|french republic|Paris|68.2|643801|3031|',
  'Tanzania||Dodoma|67.4|945087|79|',
  'South Africa||Pretoria|62.7|1221037|377|Pretoria is the executive capital; Cape Town is legislative and Bloemfontein judicial',
  'Italy|italia|Rome|59.0|301340|2255|',
  'Kenya||Nairobi|55.1|580367|108|',
  'Myanmar|burma|Naypyidaw|54.6|676578||',
  'Colombia||Bogotá|52.1|1141748|364|',
  'South Korea|korea,republic of korea,rok|Seoul|51.7|100210|1713|',
  'Uganda||Kampala|48.6|241038|49|',
  'Spain|españa,espana|Madrid|48.4|505990|1620|',
  'Sudan||Khartoum|48.1|1886068||',
  'Argentina||Buenos Aires|46.7|2780400|641|',
  'Algeria||Algiers|45.6|2381741|240|',
  'Iraq||Baghdad|45.5|438317|251|',
  'Afghanistan||Kabul|42.2|652230||',
  'Canada||Ottawa|40.1|9984670|2140|',
  'Poland|polska|Warsaw|36.7|312696|811|',
  'Morocco||Rabat|37.8|446550|141|',
  'Saudi Arabia|ksa|Riyadh|36.9|2149690|1068|',
  'Ukraine||Kyiv|37.7|603550|179|',
  'Angola||Luanda|36.7|1246700|85|',
  'Uzbekistan||Tashkent|36.4|448978|91|',
  'Peru||Lima|34.4|1285216|268|',
  'Malaysia||Kuala Lumpur|34.3|330803|400|Putrajaya is the administrative centre',
  'Ghana||Accra|34.1|238533|76|',
  'Mozambique||Maputo|33.9|801590|21|',
  'Yemen||Sanaa|34.4|527968||',
  'Nepal||Kathmandu|30.9|147516|41|',
  'Venezuela||Caracas|28.8|916445||',
  'Madagascar||Antananarivo|30.3|587041|16|',
  "Côte d'Ivoire|ivory coast,cote d'ivoire,cote divoire|Yamoussoukro|28.9|322463|79|Abidjan is the largest city and economic centre",
  'Cameroon||Yaoundé|28.6|475442||',
  'North Korea|dprk,democratic people\'s republic of korea|Pyongyang|26.2|120540||',
  'Australia||Canberra|26.6|7692024|1724|',
  'Niger||Niamey|27.2|1267000|17|',
  'Taiwan||Taipei|23.4|36197|757|',
  'Sri Lanka||Sri Jayawardenepura Kotte|22.0|65610|84|Colombo is the executive and commercial capital',
  'Burkina Faso||Ouagadougou|23.3|274200|20|',
  'Mali||Bamako|23.3|1240192|21|',
  'Syria||Damascus|23.2|185180||',
  'Kazakhstan||Astana|19.9|2724900|262|',
  'Chile||Santiago|19.6|756102|335|',
  'Romania||Bucharest|19.1|238397|351|',
  'Zambia||Lusaka|20.6|752618|28|',
  'Ecuador||Quito|18.0|283561|119|',
  'Guatemala||Guatemala City|18.1|108889|104|',
  'Somalia||Mogadishu|18.1|637657||',
  'Netherlands|the netherlands,holland|Amsterdam|17.9|41850|1118|The seat of government is The Hague',
  'Senegal||Dakar|17.8|196722|31|',
  'Cambodia||Phnom Penh|17.4|181035|42|',
  'Zimbabwe||Harare|16.7|390757||',
  'Rwanda||Kigali|14.1|26338|14|',
  'Tunisia||Tunis|12.5|163610|48|',
  'Bolivia||Sucre|12.4|1098581|46|La Paz is the seat of government',
  'Belgium||Brussels|11.8|30689|632|',
  'Haiti||Port-au-Prince|11.7|27750||',
  'Jordan||Amman|11.3|89342|51|',
  'Dominican Republic||Santo Domingo|11.3|48671|121|',
  'Cuba||Havana|11.0|109884||',
  'Czech Republic|czechia|Prague|10.9|78871|331|',
  'Sweden|sverige|Stockholm|10.5|450295|584|',
  'Portugal||Lisbon|10.5|92212|287|',
  'United Arab Emirates|uae,u.a.e.,emirates|Abu Dhabi|10.6|83600|504|',
  'Honduras||Tegucigalpa|10.6|112492|34|',
  'Greece|hellas|Athens|10.4|131957|243|',
  'Azerbaijan||Baku|10.1|86600|72|',
  'Israel||Jerusalem|9.8||514|Jerusalem is the proclaimed capital; most embassies are in Tel Aviv',
  'Hungary||Budapest|9.6|93030|212|',
  'Austria|österreich,osterreich|Vienna|9.1|83879|516|',
  'Switzerland|swiss confederation|Bern|8.85|41285|885|Bern is the federal city',
  'Bulgaria||Sofia|6.45|110994|102|',
  'Paraguay||Asunción|6.86|406752|43|',
  'Libya||Tripoli|6.89|1759540||',
  'Denmark||Copenhagen|5.95|42933|404|',
  'Singapore||Singapore|5.92|735|501|',
  'Finland|suomi|Helsinki|5.58|338455|300|',
  'Norway|norge|Oslo|5.52|385207|485|',
  'Slovakia||Bratislava|5.43|49035|133|',
  'Lebanon||Beirut|5.35|10452||',
  'Ireland|republic of ireland,eire|Dublin|5.26|70273|546|',
  'New Zealand|aotearoa|Wellington|5.22|268021|252|',
  'Costa Rica||San José|5.21|51100|86|',
  'Oman||Muscat|4.64|309500|108|',
  'Panama||Panama City|4.47|75417|83|',
  'Kuwait||Kuwait City|4.31|17818|162|',
  'Croatia||Zagreb|3.86|56594|83|',
  'Mongolia||Ulaanbaatar|3.48|1564116|20|',
  'Uruguay||Montevideo|3.42|176215|77|',
  'Jamaica||Kingston|2.83|10991|19|',
  'Qatar||Doha|2.72|11586|213|',
  'Luxembourg||Luxembourg|0.67|2586|86|',
  'Iceland||Reykjavík|0.39|103000|31|',
];

export const COUNTRIES: CountryInfo[] = ROWS.map((row) => {
  const [name = '', aliases = '', capital = '', pop = '', area = '', gdp = '', capitalNote = ''] = row.split('|');
  const c: CountryInfo = {
    name,
    aliases: aliases.split(',').map((a) => a.trim()).filter(Boolean),
    capital,
    population: Math.round(Number(pop) * 1e6),
    populationYear: 2023,
  };
  if (area) c.area = Number(area);
  if (gdp) {
    c.gdp = Number(gdp) * 1e9;
    c.gdpYear = 2023;
    c.gdpSource = name === 'Taiwan' ? 'IMF' : 'World Bank';
  }
  if (capitalNote) c.capitalNote = capitalNote;
  if (name === 'Ukraine') c.note = 'Population estimates for Ukraine are especially uncertain because of the war';
  return c;
});
