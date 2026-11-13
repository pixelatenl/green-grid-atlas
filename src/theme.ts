/**
 * Inline theme bootstrap, injected into <head> before first paint so there
 * is no flash of the wrong theme. Strategy: class on <html>, choice
 * persisted in localStorage, defaulting to the operating system
 * preference (dark when the OS expresses no light preference, since the
 * hero is designed dark-first).
 */
export const themeInitScript = `(function(){try{var s=localStorage.getItem('odp-theme')||'system';var dark=s==='dark'||(s!=='light'&&!window.matchMedia('(prefers-color-scheme: light)').matches);var e=document.documentElement;e.classList.toggle('dark',dark);e.style.colorScheme=dark?'dark':'light';}catch(err){var e=document.documentElement;e.classList.add('dark');e.style.colorScheme='dark';}})();`;

export type ThemeChoice = "system" | "light" | "dark";

export const themeStorageKey = "odp-theme";
