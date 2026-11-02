// Loaded synchronously before CSS so System or a saved choice applies on first paint.
// Keep this separate from the board: theme changes must not replace task drafts.
"use strict";

(() => {
  const key = "kanzo.theme";
  const normalize = (choice) => ["system", "light", "dark"].includes(choice) ? choice : "system";
  const media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  let preference = "system";
  try { preference = normalize(window.localStorage.getItem(key)); } catch {}

  function apply() {
    const theme = preference === "dark" || (preference === "system" && media?.matches) ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themePreference = preference;
    window.dispatchEvent(new window.CustomEvent("kanzo:theme-change", { detail: { preference, theme } }));
    return theme;
  }

  function setPreference(choice) {
    preference = normalize(choice);
    // A denied/full store must not prevent the current tab from keeping its choice.
    try { window.localStorage.setItem(key, preference); } catch {}
    apply();
    return preference;
  }

  window.KanzoTheme = Object.freeze({ getPreference: () => preference, setPreference, apply });
  const followSystem = () => { if (preference === "system") apply(); };
  if (media?.addEventListener) media.addEventListener("change", followSystem);
  else if (media?.addListener) media.addListener(followSystem);

  window.addEventListener("storage", (event) => {
    if (event.key !== key && event.key !== null) return;
    try { if (event.storageArea && event.storageArea !== window.localStorage) return; } catch { return; }
    preference = event.key === null ? "system" : normalize(event.newValue);
    apply();
  });
  apply();
})();
