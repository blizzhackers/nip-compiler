/**
 * Minimal discriminator algorithm for unique/set items.
 *
 * Given a target unique (e.g., Stone of Jordan) among siblings sharing the same
 * classId (e.g., all 9 unique rings), finds the smallest set of stat checks that
 * uniquely identifies it.
 *
 * The emitted checks use NIP stat IDs (getStatEx) so they work at runtime.
 */
import { UniqueItemDef, uniqueItems, uniqueNameToKey, uniqueNameToKeyLower, uniquesByClassId } from './d2-unique-items.js';
import { SetItemDef, setItems, setNameToKey, setNameToKeyLower, setsByClassId,
         setNameToItems, setFullNameToKey, setFullNameToKeyLower } from './d2-set-items.js';

export interface StatCheck {
  /** NIP stat name (e.g., "itemmaxmanapercent") for use in [stat] expressions */
  statName: string;
  /** getStatEx ID (number or [id, param]) */
  statId: number | [number, number];
  /** Comparison operator */
  op: '==' | '>=';
  /** Value to compare against */
  value: number;
}

export interface UniqueResolveResult {
  classIdName: string;
  classId: number;
  onlyUniqueForClassId: boolean;
  discriminator: StatCheck[];
}

export interface SetResolveResult {
  classIdName: string;
  classId: number;
  onlySetForClassId: boolean;
  discriminator: StatCheck[];
}

/**
 * Maps D2 property names (from UniqueItems.txt/SetItems.txt) to NIP stat IDs.
 * Only includes properties with clear 1:1 stat mappings.
 * Properties that set multiple stats (res-all) map to just one representative stat.
 */
const d2PropToNipStat: Record<string, { statId: number | [number, number]; statName: string } | null> = {
  'str': { statId: 0, statName: 'strength' },
  'enr': { statId: 1, statName: 'energy' },
  'dex': { statId: 2, statName: 'dexterity' },
  'vit': { statId: 3, statName: 'vitality' },
  'hp': { statId: 7, statName: 'maxhp' },
  'mana': { statId: 9, statName: 'maxmana' },
  'stam': { statId: 11, statName: 'maxstamina' },
  'att': { statId: 19, statName: 'tohit' },
  'att%': { statId: 119, statName: 'itemtohitpercent' },
  'ac': { statId: 31, statName: 'defense' },
  'ac%': { statId: [16, 0], statName: 'enhanceddefense' },
  'ac-miss': { statId: 32, statName: 'armorclassvsmissile' },
  'red-dmg': { statId: 34, statName: 'normaldamagereduction' },
  'red-mag': { statId: 35, statName: 'magicdamagereduction' },
  'res-fire': { statId: 39, statName: 'fireresist' },
  'res-fire-max': { statId: 40, statName: 'maxfireresist' },
  'res-ltng': { statId: 41, statName: 'lightresist' },
  'res-cold': { statId: 43, statName: 'coldresist' },
  'res-pois': { statId: 45, statName: 'poisonresist' },
  'res-all': { statId: 39, statName: 'fireresist' },
  'dmg-fire': { statId: 48, statName: 'firemindam' },
  'dmg-ltng': { statId: 50, statName: 'lightmindam' },
  'dmg-mag': { statId: 52, statName: 'magicmindam' },
  'dmg-cold': { statId: 54, statName: 'coldmindam' },
  'dmg-pois': { statId: 57, statName: 'poisonmindam' },
  'ltng-min': { statId: 50, statName: 'lightmindam' },
  'ltng-max': { statId: 51, statName: 'lightmaxdam' },
  'cold-min': { statId: 54, statName: 'coldmindam' },
  'cold-max': { statId: 55, statName: 'coldmaxdam' },
  'lifesteal': { statId: 60, statName: 'lifeleech' },
  'manasteal': { statId: 62, statName: 'manaleech' },
  'regen': { statId: 74, statName: 'hpregen' },
  'mana%': { statId: 77, statName: 'itemmaxmanapercent' },
  'thorns': { statId: 78, statName: 'itemattackertakesdamage' },
  'gold%': { statId: 79, statName: 'itemgoldbonus' },
  'mag%': { statId: 80, statName: 'itemmagicbonus' },
  'light': { statId: 89, statName: 'itemlightradius' },
  'ease': { statId: 91, statName: 'itemreqpercent' },
  'swing2': { statId: 93, statName: 'ias' },
  'move2': { statId: 96, statName: 'frw' },
  'allskills': { statId: 97, statName: 'itemnonclassskill' },
  'balance2': { statId: 99, statName: 'fhr' },
  'cast2': { statId: 105, statName: 'fcr' },
  'rip': { statId: 108, statName: 'itemrestinpeace' },
  'dmg-to-mana': { statId: 114, statName: 'itemdamagetomana' },
  'ignore-ac': { statId: 115, statName: 'itemignoretargetac' },
  'noheal': { statId: 117, statName: 'itempreventheal' },
  'half-freeze': { statId: 118, statName: 'itemhalffreezeduration' },
  'reduce-ac': { statId: 120, statName: 'itemdamagetargetac' },
  'dmg-demon': { statId: 121, statName: 'itemdemondamagepercent' },
  'dmg-undead': { statId: 122, statName: 'itemundeaddamagepercent' },
  'att-demon': { statId: 123, statName: 'itemdemontohit' },
  'att-undead': { statId: 124, statName: 'itemundeadtohit' },
  'dmg-norm': { statId: 111, statName: 'itemnormaldamage' },
  'crush': { statId: 136, statName: 'itemcrushingblow' },
  'openwounds': { statId: 135, statName: 'itemopenwounds' },
  'mana-kill': { statId: 138, statName: 'itemmanaafterkill' },
  'demon-heal': { statId: 139, statName: 'itemhealafterdemonkill' },
  'deadly': { statId: 141, statName: 'itemdeadlystrike' },
  'abs-fire%': { statId: 142, statName: 'itemabsorbfirepercent' },
  'abs-fire': { statId: 143, statName: 'itemabsorbfire' },
  'abs-ltng%': { statId: 144, statName: 'itemabsorblightpercent' },
  'abs-ltng': { statId: 145, statName: 'itemabsorblight' },
  'abs-cold%': { statId: 148, statName: 'itemabsorbcoldpercent' },
  'abs-cold': { statId: 149, statName: 'itemabsorbcold' },
  'slow': { statId: 150, statName: 'itemslow' },
  'indestruct': { statId: 152, statName: 'itemindestructible' },
  'nofreeze': { statId: 153, statName: 'itemcannotbefrozen' },
  'sock': { statId: 194, statName: 'sockets' },
  'regen-mana': { statId: 27, statName: 'manarecoverybonus' },
  'regen-stam': { statId: 28, statName: 'staminarecoverybonus' },
  'light-thorns': { statId: 128, statName: 'itemattackertakeslightdamage' },
  // Complex properties — no clear 1:1 mapping, skip
  'dmg%': null,
  'dmg': null,
  'dmg-ac': null,
  'all-stats': null,
  'hit-skill': null,
  'gethit-skill': null,
  'charged': null,
  'skill': null,
  'skilltab': null,
  'pal': null,
  'fireskill': null,
  'aura': null,
  'extra-cold': null,
  '*mana': null,
  'hp/lvl': null,
  'att/lvl': null,
  'dmg/lvl': null,
  'abs-fire/lvl': null,
  'deadly/lvl': null,
  'att-skill': null,
  'pois-min': null,
  'pois-max': null,
  'pois-len': null,
  'res-pois-len': null,
  'stupidity': null,
  'dmg-min': null,
  'dmg-max': null,
  'freeze': null,
  'knock': null,
  'howl': null,
  'swing3': null,
  'dmg-undead-perlevel': null,
};

interface PropValue {
  prop: string;
  min: number;
  max: number;
  fixed: boolean;
}

function getCheckableProps(item: { props: { prop: string; par: string; min: number; max: number }[] }): PropValue[] {
  return item.props
    .filter(p => d2PropToNipStat[p.prop] !== undefined && d2PropToNipStat[p.prop] !== null)
    .map(p => ({ prop: p.prop, min: p.min, max: p.max, fixed: p.min === p.max }));
}

/**
 * Find the minimal set of stat checks that uniquely identifies `target` among `siblings`.
 * Prefers: fixed stats > ranged stats, fewer checks > more.
 */
function findMinimalDiscriminator(
  target: { props: { prop: string; par: string; min: number; max: number }[] },
  siblings: { props: { prop: string; par: string; min: number; max: number }[] }[],
): StatCheck[] {
  const targetProps = getCheckableProps(target);
  if (targetProps.length === 0) return [];

  // For each sibling, find which target props can distinguish from it
  const others = siblings.filter(s => s !== target);
  if (others.length === 0) return [];

  // Try single-stat discriminators first (prefer fixed values)
  const sorted = [...targetProps].sort((a, b) => {
    if (a.fixed !== b.fixed) return a.fixed ? -1 : 1;
    return 0;
  });

  for (const prop of sorted) {
    if (distinguishesFromAll(prop, others)) {
      return [propToCheck(prop)];
    }
  }

  // Try pairs
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (pairDistinguishesFromAll(sorted[i], sorted[j], others)) {
        return [propToCheck(sorted[i]), propToCheck(sorted[j])];
      }
    }
  }

  // Fallback: use all available props (shouldn't happen for D2 data)
  return sorted.map(propToCheck);
}

function distinguishesFromAll(
  prop: PropValue,
  others: { props: { prop: string; par: string; min: number; max: number }[] }[],
): boolean {
  for (const other of others) {
    if (!distinguishesFrom(prop, other)) return false;
  }
  return true;
}

function distinguishesFrom(
  prop: PropValue,
  other: { props: { prop: string; par: string; min: number; max: number }[] },
): boolean {
  const otherProp = other.props.find(p => p.prop === prop.prop);

  if (!otherProp) {
    // Other item doesn't have this prop at all → target's value > 0 distinguishes
    return prop.min > 0;
  }

  if (prop.fixed) {
    // Fixed value: check if other's range excludes our exact value
    // If other is also fixed and different → discriminates
    if (otherProp.min === otherProp.max) return prop.min !== otherProp.min;
    // If other is ranged and our value is outside their range → discriminates
    return prop.min < otherProp.min || prop.min > otherProp.max;
  }

  // Ranged: check if our min is above other's max (>= min check)
  return prop.min > otherProp.max;
}

function pairDistinguishesFromAll(
  a: PropValue, b: PropValue,
  others: { props: { prop: string; par: string; min: number; max: number }[] }[],
): boolean {
  for (const other of others) {
    // At least one of the pair must distinguish from this sibling
    if (!distinguishesFrom(a, other) && !distinguishesFrom(b, other)) return false;
  }
  return true;
}

function propToCheck(prop: PropValue): StatCheck {
  const mapping = d2PropToNipStat[prop.prop]!;
  return {
    statName: mapping.statName,
    statId: mapping.statId,
    op: prop.fixed ? '==' : '>=',
    value: prop.min,
  };
}

/** Resolve a unique item name to its classId info + discriminator stats. */
export function resolveUnique(name: string): UniqueResolveResult | null {
  const key = uniqueNameToKey[name] ?? uniqueNameToKeyLower[name.toLowerCase()] ?? null;
  if (!key) return null;
  const item = uniqueItems[key];
  if (!item) return null;

  if (item.onlyUniqueForClassId) {
    return {
      classIdName: item.classIdName,
      classId: item.classId,
      onlyUniqueForClassId: true,
      discriminator: [],
    };
  }

  // Multiple uniques share this classId — find discriminator
  const siblingKeys = uniquesByClassId[item.classId];
  const siblings = siblingKeys.map(k => uniqueItems[k]);
  const discriminator = findMinimalDiscriminator(item, siblings);

  return {
    classIdName: item.classIdName,
    classId: item.classId,
    onlyUniqueForClassId: false,
    discriminator,
  };
}

/** Resolve a set item name. Returns null if not found. */
export function resolveSetItem(name: string): SetResolveResult | null {
  const key = setNameToKey[name] ?? setNameToKeyLower[name.toLowerCase()] ?? null;
  if (!key) return null;
  const item = setItems[key];
  if (!item) return null;

  if (item.onlySetForClassId) {
    return {
      classIdName: item.classIdName,
      classId: item.classId,
      onlySetForClassId: true,
      discriminator: [],
    };
  }

  const siblingKeys = setsByClassId[item.classId];
  const siblings = siblingKeys.map(k => setItems[k]);
  const discriminator = findMinimalDiscriminator(item, siblings);

  return {
    classIdName: item.classIdName,
    classId: item.classId,
    onlySetForClassId: false,
    discriminator,
  };
}

/**
 * Resolve a full set name (e.g., "TalRashasWrappings") to all its pieces.
 * Returns null if name is not a set name.
 */
export function resolveSetName(name: string): string[] | null {
  const key = setFullNameToKey[name] ?? setFullNameToKeyLower[name.toLowerCase()] ?? null;
  if (!key) return null;
  return setNameToItems[key] ?? null;
}

/** Check if a name is a known unique item name (PascalCase). */
export function isUniqueName(name: string): boolean {
  return (name in uniqueNameToKey) || (name.toLowerCase() in uniqueNameToKeyLower);
}

/** Check if a name is a known set item name (PascalCase). */
export function isSetItemName(name: string): boolean {
  return (name in setNameToKey) || (name.toLowerCase() in setNameToKeyLower);
}

/** Check if a name is a full set name (PascalCase). */
export function isSetName(name: string): boolean {
  return (name in setFullNameToKey) || (name.toLowerCase() in setFullNameToKeyLower);
}

/** Get all unique item names for autocomplete. */
export function getAllUniqueNames(): { name: string; key: string; classIdName: string; classId: number }[] {
  return Object.entries(uniqueNameToKey).map(([name, key]) => {
    const item = uniqueItems[key];
    return { name, key, classIdName: item.classIdName, classId: item.classId };
  });
}

/** Get all set item names for autocomplete. */
export function getAllSetItemNames(): { name: string; key: string; setName: string; classIdName: string; classId: number }[] {
  return Object.entries(setNameToKey).map(([name, key]) => {
    const item = setItems[key];
    return { name, key, setName: item.setName, classIdName: item.classIdName, classId: item.classId };
  });
}

/** Get all full set names for autocomplete. */
export function getAllSetNames(): { name: string; key: string; pieces: number }[] {
  return Object.entries(setFullNameToKey).map(([name, key]) => ({
    name, key, pieces: setNameToItems[key]?.length ?? 0,
  }));
}
