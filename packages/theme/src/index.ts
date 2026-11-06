/**
 * Bộ màu thương hiệu HWN dạng hằng số — cho canvas (Konva), WebGL (three.js) và SVG xuất file,
 * những nơi không đọc được CSS variables. Giữ đồng bộ với `tokens.css`.
 */
export const palette = {
  primary: '#0a9b4a',
  primaryDark: '#087c3b',
  primaryLight: '#4fc47e',
  primaryPale: '#e7f5ed',

  accent: '#df0984',
  accentDark: '#b3076a',
  accentLight: '#ee84c3',

  secondary: '#34b8d8',
  secondaryDark: '#1a9abe',

  white: '#ffffff',
  gray50: '#f8fafb',
  gray100: '#f0f4f6',
  gray200: '#e2e8ec',
  gray300: '#cbd5dc',
  gray400: '#9aaab6',
  gray500: '#6b8090',
  gray600: '#4a6070',
  gray700: '#2d4050',
  gray800: '#1a2a35',
  gray900: '#0d1820',

  success: '#0a9b4a',
  warning: '#f5a623',
  error: '#e84545',
  info: '#34b8d8',

  blueSolid: '#1a6abd',
  purpleSolid: '#5b4fc4',
} as const;

export type PaletteColor = keyof typeof palette;
