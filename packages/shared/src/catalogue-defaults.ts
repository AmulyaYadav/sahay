import type { CategoryGroup, Unit } from './constants.js';

/**
 * Default supply catalogue seeded into new deployments. Admins can edit, disable,
 * or add categories at runtime — this file is only the initial seed (§10).
 * Prohibited goods (medicines, intoxicants, weapons, fuel, …) are intentionally absent
 * and also blocked by a server-side denylist on category creation.
 */
export interface CatalogueSeed {
  slug: string;
  group: CategoryGroup;
  name: { en: string; hi: string };
  /**
   * Plural form, used when a counted quantity is shown. Omit when the name has
   * no distinct plural — already-plural entries ("Biscuits"), mass nouns
   * ("Fruit", "Soap"), or where a numeral + singular is the natural phrasing.
   * Hindi is omitted throughout: the counted string puts the number after the
   * noun ("टॉर्च — 40 चाहिए"), so no inflection is called for.
   */
  namePlural?: { en?: string; hi?: string };
  icon: string;
  unit: Unit;
  altUnits?: Unit[];
  fractional?: boolean;
  sealedRequired?: boolean;
  expiryRelevant?: boolean;
  restricted?: boolean;
  warningKey?: string;
  maxRequestQty: number;
  maxOfferQty: number;
}

export const DEFAULT_CATALOGUE: CatalogueSeed[] = [
  // Hydration
  { slug: 'water-bottle', group: 'hydration', name: { en: 'Sealed water bottle', hi: 'सीलबंद पानी की बोतल' }, namePlural: { en: 'Sealed water bottles' }, icon: 'droplet', unit: 'bottle', altUnits: ['litre'], sealedRequired: true, expiryRelevant: true, maxRequestQty: 6, maxOfferQty: 100 },
  { slug: 'water-pack', group: 'hydration', name: { en: 'Packaged water container', hi: 'पैकेज्ड पानी का डिब्बा' }, namePlural: { en: 'Packaged water containers' }, icon: 'droplet', unit: 'packet', sealedRequired: true, maxRequestQty: 4, maxOfferQty: 50 },
  { slug: 'ors', group: 'hydration', name: { en: 'Oral rehydration sachet (sealed)', hi: 'ओआरएस पाउच (सीलबंद)' }, namePlural: { en: 'Oral rehydration sachets (sealed)' }, icon: 'droplet', unit: 'packet', sealedRequired: true, expiryRelevant: true, restricted: true, warningKey: 'safety.noOpened', maxRequestQty: 4, maxOfferQty: 30 },
  // Food
  { slug: 'packaged-food', group: 'food', name: { en: 'Sealed packaged food', hi: 'सीलबंद पैकेज्ड भोजन' }, icon: 'utensils', unit: 'packet', sealedRequired: true, expiryRelevant: true, maxRequestQty: 5, maxOfferQty: 50 },
  { slug: 'meal', group: 'food', name: { en: 'Packaged meal', hi: 'पैक किया हुआ भोजन' }, namePlural: { en: 'Packaged meals' }, icon: 'utensils', unit: 'meal', sealedRequired: true, maxRequestQty: 4, maxOfferQty: 50 },
  { slug: 'biscuits', group: 'food', name: { en: 'Biscuits', hi: 'बिस्कुट' }, icon: 'cookie', unit: 'packet', sealedRequired: true, expiryRelevant: true, maxRequestQty: 5, maxOfferQty: 50 },
  { slug: 'fruit', group: 'food', name: { en: 'Fruit', hi: 'फल' }, icon: 'apple', unit: 'piece', maxRequestQty: 6, maxOfferQty: 40 },
  { slug: 'baby-food', group: 'food', name: { en: 'Baby food (sealed)', hi: 'शिशु आहार (सीलबंद)' }, icon: 'baby', unit: 'packet', sealedRequired: true, expiryRelevant: true, warningKey: 'safety.noOpened', maxRequestQty: 3, maxOfferQty: 20 },
  // Shelter & rest
  { slug: 'blanket', group: 'shelter', name: { en: 'Blanket', hi: 'कंबल' }, namePlural: { en: 'Blankets' }, icon: 'bed', unit: 'blanket', maxRequestQty: 3, maxOfferQty: 30 },
  { slug: 'sleeping-mat', group: 'shelter', name: { en: 'Sleeping mat', hi: 'सोने की चटाई' }, namePlural: { en: 'Sleeping mats' }, icon: 'bed', unit: 'piece', maxRequestQty: 2, maxOfferQty: 20 },
  { slug: 'tarpaulin', group: 'shelter', name: { en: 'Tarpaulin', hi: 'तिरपाल' }, namePlural: { en: 'Tarpaulins' }, icon: 'tent', unit: 'piece', maxRequestQty: 2, maxOfferQty: 15 },
  { slug: 'towel', group: 'shelter', name: { en: 'Towel', hi: 'तौलिया' }, namePlural: { en: 'Towels' }, icon: 'towel', unit: 'piece', maxRequestQty: 2, maxOfferQty: 20 },
  { slug: 'mosquito-net', group: 'shelter', name: { en: 'Mosquito net', hi: 'मच्छरदानी' }, namePlural: { en: 'Mosquito nets' }, icon: 'shield', unit: 'piece', maxRequestQty: 2, maxOfferQty: 15 },
  { slug: 'mosquito-repellent', group: 'shelter', name: { en: 'Mosquito repellent', hi: 'मच्छर भगाने की क्रीम/स्प्रे' }, icon: 'shield', unit: 'piece', sealedRequired: true, maxRequestQty: 2, maxOfferQty: 15 },
  { slug: 'raincoat', group: 'shelter', name: { en: 'Raincoat', hi: 'रेनकोट' }, namePlural: { en: 'Raincoats' }, icon: 'cloud-rain', unit: 'piece', maxRequestQty: 2, maxOfferQty: 20 },
  { slug: 'umbrella', group: 'shelter', name: { en: 'Umbrella', hi: 'छाता' }, namePlural: { en: 'Umbrellas' }, icon: 'umbrella', unit: 'piece', maxRequestQty: 1, maxOfferQty: 15 },
  // Hygiene
  { slug: 'sanitary-pads', group: 'hygiene', name: { en: 'Sanitary pads', hi: 'सैनिटरी पैड' }, icon: 'heart', unit: 'packet', sealedRequired: true, maxRequestQty: 3, maxOfferQty: 30 },
  { slug: 'diapers', group: 'hygiene', name: { en: 'Diapers', hi: 'डायपर' }, icon: 'baby', unit: 'packet', sealedRequired: true, maxRequestQty: 3, maxOfferQty: 20 },
  { slug: 'tissues', group: 'hygiene', name: { en: 'Tissues', hi: 'टिशू' }, icon: 'box', unit: 'packet', maxRequestQty: 4, maxOfferQty: 40 },
  { slug: 'wet-wipes', group: 'hygiene', name: { en: 'Wet wipes', hi: 'गीले वाइप्स' }, icon: 'box', unit: 'packet', sealedRequired: true, maxRequestQty: 3, maxOfferQty: 30 },
  { slug: 'soap', group: 'hygiene', name: { en: 'Soap', hi: 'साबुन' }, icon: 'droplets', unit: 'piece', sealedRequired: true, maxRequestQty: 3, maxOfferQty: 40 },
  { slug: 'masks', group: 'hygiene', name: { en: 'Masks', hi: 'मास्क' }, icon: 'shield', unit: 'piece', sealedRequired: true, maxRequestQty: 10, maxOfferQty: 100 },
  { slug: 'sanitizer', group: 'hygiene', name: { en: 'Hand sanitizer (sealed)', hi: 'हैंड सैनिटाइज़र (सीलबंद)' }, icon: 'droplets', unit: 'bottle', sealedRequired: true, maxRequestQty: 2, maxOfferQty: 20 },
  { slug: 'waste-bags', group: 'hygiene', name: { en: 'Waste bags', hi: 'कचरा बैग' }, icon: 'trash', unit: 'roll', maxRequestQty: 3, maxOfferQty: 30 },
  // Lighting & power
  { slug: 'torch', group: 'power', name: { en: 'Torch', hi: 'टॉर्च' }, namePlural: { en: 'Torches' }, icon: 'flashlight', unit: 'piece', maxRequestQty: 2, maxOfferQty: 15 },
  { slug: 'batteries', group: 'power', name: { en: 'Batteries', hi: 'बैटरियाँ' }, icon: 'battery', unit: 'battery', maxRequestQty: 8, maxOfferQty: 60 },
  { slug: 'power-bank', group: 'power', name: { en: 'Power bank (charged)', hi: 'पावर बैंक (चार्ज किया हुआ)' }, namePlural: { en: 'Power banks (charged)' }, icon: 'battery-charging', unit: 'piece', maxRequestQty: 1, maxOfferQty: 10 },
  { slug: 'charging-cable', group: 'power', name: { en: 'Charging cable', hi: 'चार्जिंग केबल' }, namePlural: { en: 'Charging cables' }, icon: 'cable', unit: 'piece', maxRequestQty: 2, maxOfferQty: 15 },
  { slug: 'charging-adapter', group: 'power', name: { en: 'Charging adapter', hi: 'चार्जिंग अडैप्टर' }, namePlural: { en: 'Charging adapters' }, icon: 'plug', unit: 'piece', maxRequestQty: 1, maxOfferQty: 10 },
  // Clothing
  { slug: 'shirt', group: 'clothing', name: { en: 'Shirt', hi: 'कमीज़' }, namePlural: { en: 'Shirts' }, icon: 'shirt', unit: 'piece', maxRequestQty: 3, maxOfferQty: 25 },
  { slug: 'jacket', group: 'clothing', name: { en: 'Jacket', hi: 'जैकेट' }, namePlural: { en: 'Jackets' }, icon: 'shirt', unit: 'piece', maxRequestQty: 2, maxOfferQty: 15 },
  { slug: 'socks', group: 'clothing', name: { en: 'Socks', hi: 'मोज़े' }, icon: 'footprints', unit: 'pair', maxRequestQty: 4, maxOfferQty: 30 },
  { slug: 'gloves', group: 'clothing', name: { en: 'Gloves', hi: 'दस्ताने' }, icon: 'hand', unit: 'pair', maxRequestQty: 2, maxOfferQty: 20 },
  { slug: 'warm-clothing', group: 'clothing', name: { en: 'Warm clothing', hi: 'गर्म कपड़े' }, icon: 'shirt', unit: 'piece', maxRequestQty: 3, maxOfferQty: 25 },
  // First aid (non-drug only)
  { slug: 'bandages', group: 'first_aid', name: { en: 'Adhesive bandages (sealed)', hi: 'चिपकने वाली पट्टियाँ (सीलबंद)' }, icon: 'bandage', unit: 'piece', sealedRequired: true, expiryRelevant: true, warningKey: 'safety.noOpened', maxRequestQty: 10, maxOfferQty: 100 },
  { slug: 'gauze', group: 'first_aid', name: { en: 'Sterile gauze (sealed)', hi: 'स्टेराइल गॉज़ (सीलबंद)' }, icon: 'bandage', unit: 'packet', sealedRequired: true, expiryRelevant: true, warningKey: 'safety.noOpened', maxRequestQty: 5, maxOfferQty: 40 },
  { slug: 'medical-tape', group: 'first_aid', name: { en: 'Medical tape', hi: 'मेडिकल टेप' }, icon: 'bandage', unit: 'roll', sealedRequired: true, maxRequestQty: 2, maxOfferQty: 20 },
  { slug: 'disposable-gloves', group: 'first_aid', name: { en: 'Disposable gloves', hi: 'डिस्पोज़ेबल दस्ताने' }, icon: 'hand', unit: 'pair', sealedRequired: true, maxRequestQty: 5, maxOfferQty: 50 },
  { slug: 'cold-pack', group: 'first_aid', name: { en: 'Sealed cold pack', hi: 'सीलबंद कोल्ड पैक' }, namePlural: { en: 'Sealed cold packs' }, icon: 'snowflake', unit: 'piece', sealedRequired: true, maxRequestQty: 2, maxOfferQty: 15 },
  // Misc
  { slug: 'stationery', group: 'misc', name: { en: 'Stationery', hi: 'स्टेशनरी' }, icon: 'pencil', unit: 'item', maxRequestQty: 10, maxOfferQty: 100 },
  { slug: 'notebook', group: 'misc', name: { en: 'Notebook', hi: 'नोटबुक' }, namePlural: { en: 'Notebooks' }, icon: 'notebook', unit: 'piece', maxRequestQty: 3, maxOfferQty: 30 },
  { slug: 'rope', group: 'misc', name: { en: 'Rope', hi: 'रस्सी' }, icon: 'cable', unit: 'roll', maxRequestQty: 2, maxOfferQty: 15 },
  { slug: 'container', group: 'misc', name: { en: 'Reusable container', hi: 'दोबारा इस्तेमाल होने वाला डिब्बा' }, namePlural: { en: 'Reusable containers' }, icon: 'box', unit: 'piece', maxRequestQty: 3, maxOfferQty: 25 },
];

/**
 * Server-side denylist: category slugs/names matching these patterns can never be
 * created or enabled, even by admins (§10 exclusions).
 */
export const PROHIBITED_PATTERNS: RegExp[] = [
  /medicin|tablet|drug|pharma|pill|capsule|syrup|antibiotic|insulin|inject/i,
  /alcohol|liquor|beer|wine|cigarette|tobacco|vape|intoxic/i,
  /weapon|knife|gun|firearm|ammo|explos|firework/i,
  /fuel|petrol|diesel|kerosene|gas cylinder|chemical/i,
  /blood|organ|bodily/i,
];

/**
 * Picks the name to show for a category, using the plural form when the count
 * calls for it. Lives here rather than in a client so web and mobile cannot
 * drift apart on it.
 *
 * `qty` null/undefined means no count is being shown, which takes the singular.
 *
 * Fallback order is deliberately locale-first: plural in this locale → SINGULAR
 * in this locale → English plural → English name → slug. Reaching for the
 * English plural before the locale's own singular would print English words in
 * a Hindi interface, which is worse than an uninflected but correct noun. A
 * category with no distinct plural (already plural, or a mass noun) records
 * none and keeps its name.
 */
export function categoryDisplayName(
  category: {
    slug: string;
    name: Record<string, string>;
    namePlural?: Record<string, string> | undefined;
  },
  locale: string,
  qty?: number | null,
): string {
  const localeSingular = category.name[locale];
  const fallbackSingular = localeSingular ?? category.name.en ?? category.slug;
  if (qty == null || qty === 1) return fallbackSingular;
  return (
    category.namePlural?.[locale] ??
    localeSingular ??
    category.namePlural?.en ??
    category.name.en ??
    category.slug
  );
}
