const localAvatarPalette = ['#4A90D9', '#4A9D72', '#D9824A', '#8F6ED5', '#D94A73'];

export function getLocalContactAvatarBg(id: string) {
  const sum = Array.from(id).reduce((value, char) => value + char.charCodeAt(0), 0);
  return localAvatarPalette[sum % localAvatarPalette.length];
}
