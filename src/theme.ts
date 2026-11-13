/**
 * Theme plumbing. The choice is persisted in localStorage under
 * themeStorageKey; the no-flash bootstrap script itself lives in
 * public/theme-init.js (see themeInitScriptSrc) and is hoisted into the
 * initial HTML <head> as a blocking <script src> via ReactDOM.preinit in
 * app/layout.tsx — a server-emitted tag, so it runs before first paint,
 * and not a <script> element in the React tree, which React never executes
 * when client-rendering.
 */
export const themeInitScriptSrc = "/theme-init.js";

export type ThemeChoice = "system" | "light" | "dark";

export const themeStorageKey = "odp-theme";
