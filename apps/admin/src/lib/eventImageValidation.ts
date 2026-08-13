export const EVENT_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";
export const MAX_EVENT_IMAGE_SOURCE_BYTES = 12 * 1024 * 1024;
export const RECOMMENDED_EVENT_IMAGE_WIDTH = 1200;
export const RECOMMENDED_EVENT_IMAGE_HEIGHT = 675;

const ACCEPTED_EVENT_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const RECOMMENDED_EVENT_IMAGE_ASPECT_RATIO = 16 / 9;
const SUBSTANTIAL_ASPECT_RATIO_DIFFERENCE = 0.12;

export type EventImageValidationErrorCode =
  | "unsupported_event_image_type"
  | "event_image_too_large"
  | "invalid_event_image";

export type EventImageDimensions = {
  height: number;
  width: number;
};

export function validateEventImageSource(
  source: Pick<File, "size" | "type">,
): EventImageValidationErrorCode | null {
  if (!ACCEPTED_EVENT_IMAGE_TYPES.has(source.type.toLocaleLowerCase("en-US"))) {
    return "unsupported_event_image_type";
  }

  if (source.size > MAX_EVENT_IMAGE_SOURCE_BYTES) {
    return "event_image_too_large";
  }

  return null;
}

export function getEventImageDimensionWarnings(
  dimensions: EventImageDimensions,
): string[] {
  if (dimensions.width <= 0 || dimensions.height <= 0) {
    return [];
  }

  const warnings: string[] = [];
  if (
    dimensions.width < RECOMMENDED_EVENT_IMAGE_WIDTH
    || dimensions.height < RECOMMENDED_EVENT_IMAGE_HEIGHT
  ) {
    warnings.push(
      `Изображение меньше рекомендуемых ${RECOMMENDED_EVENT_IMAGE_WIDTH}×${RECOMMENDED_EVENT_IMAGE_HEIGHT} пикселей.`,
    );
  }

  const sourceAspectRatio = dimensions.width / dimensions.height;
  const relativeDifference = Math.abs(
    sourceAspectRatio - RECOMMENDED_EVENT_IMAGE_ASPECT_RATIO,
  ) / RECOMMENDED_EVENT_IMAGE_ASPECT_RATIO;

  if (relativeDifference > SUBSTANTIAL_ASPECT_RATIO_DIFFERENCE) {
    warnings.push(
      "Соотношение сторон заметно отличается от 16:9. В некоторых карточках края изображения могут быть обрезаны.",
    );
  }

  return warnings;
}

export function formatEventImageSourceSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 Б";
  }

  const mebibytes = bytes / (1024 * 1024);
  if (mebibytes >= 1) {
    return `${mebibytes.toLocaleString("ru-RU", {
      maximumFractionDigits: 1,
      minimumFractionDigits: 1,
    })} МБ`;
  }

  const kibibytes = bytes / 1024;
  return `${Math.max(1, Math.round(kibibytes)).toLocaleString("ru-RU")} КБ`;
}

export function getEventImageValidationMessage(
  code: EventImageValidationErrorCode,
): string {
  if (code === "unsupported_event_image_type") {
    return "Выберите файл JPG, PNG или WebP.";
  }

  if (code === "event_image_too_large") {
    return "Файл больше 12 МБ. Выберите изображение меньшего размера.";
  }

  return "Не удалось прочитать изображение. Выберите другой файл.";
}
