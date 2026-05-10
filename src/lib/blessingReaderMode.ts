import type { BlessingTextResult } from '@/types/blessing';

const blessingReaderModeSlugs = new Set([
  'birkat_hamazon',
  'mein_shalosh',
  'mein_shalosh_al_hamichya',
  'mein_shalosh_al_hagefen',
  'mein_shalosh_al_haetz',
]);

export function supportsBlessingReaderMode(
  textResult: BlessingTextResult | null,
): textResult is BlessingTextResult {
  return Boolean(textResult && blessingReaderModeSlugs.has(textResult.blessing.slug));
}
