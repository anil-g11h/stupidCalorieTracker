export type EaaRatioGroupKey = 'leucine' | 'lysine' | 'valineIsoleucine' | 'rest';

export interface EaaInputItem {
  proteinGrams: number;
  amountConsumed: number;
  micros?: Record<string, number>;
}

export interface EaaRatioAnalysis {
  proteinTotal: number;
  proteinWithEaaData: number;
  proteinMissingEaaData: number;
  eaaTotal: number;
  eaaAsProteinPercent: number;
  groups: Record<EaaRatioGroupKey, number>;
  targetByCurrentTotal: Record<EaaRatioGroupKey, number>;
  deficitByGroup: Record<EaaRatioGroupKey, number>;
}

export interface EaaFoodScore {
  score: number;
  filledByGroup: Record<EaaRatioGroupKey, number>;
  contribution: Record<EaaRatioGroupKey, number>;
}

const GROUP_PARTS: Record<EaaRatioGroupKey, number> = {
  leucine: 4,
  lysine: 2,
  valineIsoleucine: 2,
  rest: 2
};

const ALIASES: Record<EaaRatioGroupKey, string[]> = {
  leucine: ['leucine', 'leu', 'l-leucine'],
  lysine: ['lysine', 'lys', 'l-lysine'],
  valineIsoleucine: ['valine', 'l-valine', 'isoleucine', 'l-isoleucine'],
  rest: [
    'threonine',
    'l-threonine',
    'phenylalanine',
    'l-phenylalanine',
    'histidine',
    'l-histidine',
    'methionine',
    'l-methionine',
    'tryptophan',
    'l-tryptophan'
  ]
};

const aliasLookup = Object.entries(ALIASES).reduce<Record<string, EaaRatioGroupKey>>((acc, [group, aliases]) => {
  aliases.forEach((alias) => {
    acc[normalizeKey(alias)] = group as EaaRatioGroupKey;
  });
  return acc;
}, {});

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[_\s-]+/g, '');
}

function toPositiveNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

function emptyGroupMap(): Record<EaaRatioGroupKey, number> {
  return {
    leucine: 0,
    lysine: 0,
    valineIsoleucine: 0,
    rest: 0
  };
}

export function getEaaGroupContribution(
  micros: Record<string, number> | undefined,
  amountConsumed = 1
): Record<EaaRatioGroupKey, number> {
  const groups = emptyGroupMap();
  if (!micros) return groups;

  const amount = toPositiveNumber(amountConsumed);
  if (amount <= 0) return groups;

  Object.entries(micros).forEach(([rawKey, rawValue]) => {
    const group = aliasLookup[normalizeKey(rawKey)];
    if (!group) return;

    const grams = toPositiveNumber(rawValue) * amount;
    if (grams <= 0) return;

    groups[group] += grams;
  });

  return groups;
}

export function scoreFoodForEaaDeficit(
  micros: Record<string, number> | undefined,
  deficitByGroup: Record<EaaRatioGroupKey, number>,
  amountConsumed = 1
): EaaFoodScore {
  const contribution = getEaaGroupContribution(micros, amountConsumed);

  const filledByGroup: Record<EaaRatioGroupKey, number> = {
    leucine: Math.min(deficitByGroup.leucine, contribution.leucine),
    lysine: Math.min(deficitByGroup.lysine, contribution.lysine),
    valineIsoleucine: Math.min(deficitByGroup.valineIsoleucine, contribution.valineIsoleucine),
    rest: Math.min(deficitByGroup.rest, contribution.rest)
  };

  const score = Object.values(filledByGroup).reduce((sum, value) => sum + value, 0);

  return {
    score,
    filledByGroup,
    contribution
  };
}

export function analyzeEaaRatio(items: EaaInputItem[]): EaaRatioAnalysis {
  const groups = emptyGroupMap();

  let proteinTotal = 0;
  let proteinWithEaaData = 0;

  items.forEach((item) => {
    const amountConsumed = toPositiveNumber(item.amountConsumed);
    const protein = toPositiveNumber(item.proteinGrams) * amountConsumed;
    proteinTotal += protein;

    const micros = item.micros;
    if (!micros) return;

    let foodEaaContribution = 0;

    Object.entries(micros).forEach(([rawKey, rawValue]) => {
      const group = aliasLookup[normalizeKey(rawKey)];
      if (!group) return;

      const grams = toPositiveNumber(rawValue) * amountConsumed;
      if (grams <= 0) return;

      groups[group] += grams;
      foodEaaContribution += grams;
    });

    if (foodEaaContribution > 0) {
      proteinWithEaaData += protein;
    }
  });

  const eaaTotal = Object.values(groups).reduce((sum, value) => sum + value, 0);
  const unit = eaaTotal / 10;

  const targetByCurrentTotal: Record<EaaRatioGroupKey, number> = {
    leucine: unit * GROUP_PARTS.leucine,
    lysine: unit * GROUP_PARTS.lysine,
    valineIsoleucine: unit * GROUP_PARTS.valineIsoleucine,
    rest: unit * GROUP_PARTS.rest
  };

  const deficitByGroup: Record<EaaRatioGroupKey, number> = {
    leucine: Math.max(0, targetByCurrentTotal.leucine - groups.leucine),
    lysine: Math.max(0, targetByCurrentTotal.lysine - groups.lysine),
    valineIsoleucine: Math.max(0, targetByCurrentTotal.valineIsoleucine - groups.valineIsoleucine),
    rest: Math.max(0, targetByCurrentTotal.rest - groups.rest)
  };

  return {
    proteinTotal,
    proteinWithEaaData,
    proteinMissingEaaData: Math.max(0, proteinTotal - proteinWithEaaData),
    eaaTotal,
    eaaAsProteinPercent: proteinTotal > 0 ? (eaaTotal / proteinTotal) * 100 : 0,
    groups,
    targetByCurrentTotal,
    deficitByGroup
  };
}
