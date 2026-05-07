const brachasSourcePrefix = ['Brachas', 'txt'].join('.');
const brachasPublicTitle = '"Руководство по благословениям" Рабби Шнеур-Залман из Ляд';

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

function getBrachasDetail(sourceRef: string): string | null {
  if (sourceRef === brachasSourcePrefix) {
    return null;
  }

  if (!sourceRef.startsWith(`${brachasSourcePrefix}:`)) {
    return null;
  }

  const detail = sourceRef.slice(brachasSourcePrefix.length + 1).trim();
  return detail.length > 0 ? detail : null;
}

export function formatBlessingSourceRefs(sourceRefs: readonly string[]): string | null {
  if (sourceRefs.length === 0) {
    return null;
  }

  const normalizedRefs = uniqueStrings(sourceRefs.map((sourceRef) => sourceRef.trim()).filter(Boolean));
  const brachasRefs = normalizedRefs.filter(
    (sourceRef) =>
      sourceRef === brachasSourcePrefix || sourceRef.startsWith(`${brachasSourcePrefix}:`),
  );
  const otherRefs = normalizedRefs.filter((sourceRef) => !brachasRefs.includes(sourceRef));
  const brachasDetails = uniqueStrings(
    brachasRefs.map((sourceRef) => getBrachasDetail(sourceRef)).filter((detail) => detail !== null),
  );
  const formattedSources = [
    ...(brachasRefs.length > 0
      ? [
          brachasDetails.length > 0
            ? `${brachasPublicTitle}, ${brachasDetails.join('; ')}`
            : brachasPublicTitle,
        ]
      : []),
    ...otherRefs,
  ];

  if (formattedSources.length === 0) {
    return null;
  }

  return `Источник: ${formattedSources.join('; ')}`;
}
