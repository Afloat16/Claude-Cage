export const systemUIFont =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif';
export const systemCodeFont = '"SF Mono", Menlo, Consolas, monospace';
export const presets = {
  light: {
    codex: {
      accent: "#339cff",
      surface: "#ffffff",
      ink: "#1a1c1f",
      contrast: 45,
    },
    solarized: {
      accent: "#b58900",
      surface: "#fdf6e3",
      ink: "#657b83",
      contrast: 45,
    },
  },
  dark: {
    codex: {
      accent: "#339cff",
      surface: "#181818",
      ink: "#ffffff",
      contrast: 60,
    },
    ayu: {
      accent: "#e6b450",
      surface: "#10141c",
      ink: "#bfbdb6",
      contrast: 60,
    },
    solarized: {
      accent: "#b58900",
      surface: "#002b36",
      ink: "#93a1a1",
      contrast: 60,
    },
  },
};
export const presetNames = {
  codex: "Codex",
  solarized: "Solarized",
  ayu: "Ayu",
};
export const defaultAppearance = {
  mode: "system",
  lightTheme: {
    ...presets.light.codex,
    preset: "codex",
    opaqueWindows: false,
    fonts: { ui: "", code: "" },
  },
  darkTheme: {
    ...presets.dark.codex,
    preset: "codex",
    opaqueWindows: false,
    fonts: { ui: "", code: "" },
  },
  uiFontSize: 14,
  codeFontSize: 13,
  pointerCursors: false,
  fontSmoothing: true,
  reducedMotion: "system",
};
export function normalizeAppearance(value = {}) {
  return {
    ...defaultAppearance,
    ...value,
    lightTheme: {
      ...defaultAppearance.lightTheme,
      ...value.lightTheme,
      fonts: {
        ...defaultAppearance.lightTheme.fonts,
        ...value.lightTheme?.fonts,
      },
    },
    darkTheme: {
      ...defaultAppearance.darkTheme,
      ...value.darkTheme,
      fonts: {
        ...defaultAppearance.darkTheme.fonts,
        ...value.darkTheme?.fonts,
      },
    },
  };
}
export function mix(a, b, weight) {
  const rgb = (hex) =>
    [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  const left = rgb(a),
    right = rgb(b);
  return (
    "#" +
    left
      .map((value, index) =>
        Math.round(value + (right[index] - value) * weight)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
function luminance(hex) {
  const [r, g, b] = [1, 3, 5]
    .map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}
export function themeVariables(theme, variant) {
  const { surface, ink, accent, contrast } = theme;
  const chrome = mix(surface, ink, 0.025 + contrast * 0.00055);
  const line = mix(surface, ink, 0.09 + contrast * 0.0013);
  return {
    "--paper": surface,
    "--chrome": chrome,
    "--chrome-dark": mix(surface, ink, 0.1),
    "--ink": ink,
    "--strong": mix(ink, variant === "light" ? "#000000" : "#ffffff", 0.15),
    "--muted": mix(ink, surface, 0.15),
    "--accent": accent,
    "--focus": accent,
    "--input": surface,
    "--line": line,
    "--hover": mix(surface, ink, 0.09),
    "--selected": mix(surface, ink, 0.13),
    "--selection": mix(surface, accent, 0.32),
    "--button": ink,
    "--button-ink": surface,
    "--link": accent,
    "--success": variant === "dark" ? "#70bf56" : "#357c3c",
    "--danger": variant === "dark" ? "#f26d78" : "#bb3535",
    "--ui-font-family": theme.fonts.ui || systemUIFont,
    "--code-font-family": theme.fonts.code || systemCodeFont,
    "--accent-ink": luminance(accent) > 0.4 ? "#111111" : "#ffffff",
  };
}
export function terminalTheme(theme, variant) {
  return {
    background: theme.surface,
    foreground: theme.ink,
    cursor: theme.ink,
    selectionBackground: mix(theme.surface, theme.accent, 0.32),
    black: variant === "dark" ? "#202020" : "#242424",
    red: variant === "dark" ? "#f26d78" : "#c43d3d",
    green: variant === "dark" ? "#aad94c" : "#4b7b23",
    yellow: theme.accent,
    blue: variant === "dark" ? "#59c2ff" : "#206bb1",
    magenta: variant === "dark" ? "#d2a6ff" : "#a03e9c",
    cyan: variant === "dark" ? "#95e6cb" : "#187b74",
    white: variant === "dark" ? "#bfbdb6" : "#dadada",
    brightBlack: "#737373",
    brightRed: "#fa7784",
    brightGreen: "#a4d86a",
    brightYellow: "#ffd173",
    brightBlue: "#73d0ff",
    brightMagenta: "#d4bfff",
    brightCyan: "#95e6cb",
    brightWhite: "#ffffff",
  };
}
