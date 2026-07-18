import type { BudgetTier, Continent } from './types';

/**
 * Curated pool for "surprise me" and continent picks.
 *
 * Hardcoded rather than model-generated so the surprise is instant and always
 * geocodable — every entry is a specific city, not a region. Grouped by budget
 * so a shoestring surprise doesn't land in Zurich.
 */
const POOL: Record<Continent, Record<BudgetTier, string[]>> = {
  Europe: {
    shoestring: ['Porto, Portugal', 'Kraków, Poland', 'Tbilisi, Georgia', 'Sofia, Bulgaria'],
    mid: ['Lisbon, Portugal', 'Seville, Spain', 'Ljubljana, Slovenia', 'Naples, Italy'],
    splurge: ['Copenhagen, Denmark', 'Zermatt, Switzerland', 'Amalfi, Italy', 'Reykjavik, Iceland'],
  },
  Asia: {
    shoestring: ['Chiang Mai, Thailand', 'Hanoi, Vietnam', 'Kathmandu, Nepal', 'Yogyakarta, Indonesia'],
    mid: ['Osaka, Japan', 'Seoul, South Korea', 'Taipei, Taiwan', 'Penang, Malaysia'],
    splurge: ['Kyoto, Japan', 'Singapore', 'Bhutan', 'Niseko, Japan'],
  },
  Africa: {
    shoestring: ['Dakar, Senegal', 'Essaouira, Morocco', 'Kampala, Uganda', 'Dahab, Egypt'],
    mid: ['Marrakech, Morocco', 'Cape Town, South Africa', 'Zanzibar, Tanzania', 'Nairobi, Kenya'],
    splurge: ['Victoria Falls, Zimbabwe', 'Serengeti, Tanzania', 'Seychelles', 'Cairo, Egypt'],
  },
  'North America': {
    shoestring: ['Oaxaca, Mexico', 'Guatemala City, Guatemala', 'Montreal, Canada', 'New Orleans, Louisiana'],
    mid: ['Mexico City, Mexico', 'Vancouver, Canada', 'Santa Fe, New Mexico', 'Portland, Oregon'],
    splurge: ['Banff, Canada', 'Aspen, Colorado', 'Tulum, Mexico', 'Big Sur, California'],
  },
  'South America': {
    shoestring: ['Medellín, Colombia', 'La Paz, Bolivia', 'Cusco, Peru', 'Quito, Ecuador'],
    mid: ['Buenos Aires, Argentina', 'Lima, Peru', 'Valparaíso, Chile', 'Cartagena, Colombia'],
    splurge: ['Rio de Janeiro, Brazil', 'Patagonia, Chile', 'Galápagos, Ecuador', 'Mendoza, Argentina'],
  },
  Oceania: {
    shoestring: ['Bali, Indonesia', 'Suva, Fiji', 'Rotorua, New Zealand', 'Cairns, Australia'],
    mid: ['Melbourne, Australia', 'Auckland, New Zealand', 'Queenstown, New Zealand', 'Perth, Australia'],
    splurge: ['Bora Bora, French Polynesia', 'Sydney, Australia', 'Great Barrier Reef, Australia', 'Fiji'],
  },
};

/** Pick a destination for "surprise me" (any continent) or a named continent. */
export function pickDestination(budgetTier: BudgetTier, continent?: Continent): string {
  const continents = continent
    ? [continent]
    : (Object.keys(POOL) as Continent[]);
  const chosenContinent = continents[Math.floor(Math.random() * continents.length)];
  const options = POOL[chosenContinent][budgetTier];
  return options[Math.floor(Math.random() * options.length)];
}
