/*
 * Theme bootstrap, hoisted into the initial HTML <head> as a blocking
 * <script src> via ReactDOM.preinit in app/layout.tsx, so it runs before
 * first paint and there is no flash of the wrong theme. Strategy: class on
 * <html>, choice persisted in localStorage, defaulting to the operating
 * system preference (dark when the OS expresses no light preference, since
 * the hero is designed dark-first). The storage key lives in src/theme.ts.
 */
(function () {
  try {
    var s = localStorage.getItem("odp-theme") || "system";
    var dark =
      s === "dark" ||
      (s !== "light" && !window.matchMedia("(prefers-color-scheme: light)").matches);
    var e = document.documentElement;
    e.classList.toggle("dark", dark);
    e.style.colorScheme = dark ? "dark" : "light";
  } catch (err) {
    var e = document.documentElement;
    e.classList.add("dark");
    e.style.colorScheme = "dark";
  }
})();
