"use client"

/**
 * 화면 모드 (design-system 8 Q-2): "system" (default) follows the OS, "light" / "dark" pin it.
 * The choice lives in localStorage (per browser). THEME_SCRIPT runs in <head> before first paint
 * so the page never flashes the wrong theme; useTheme() reads and changes it afterwards.
 */
import * as React from "react"

export type ThemePreference = "system" | "light" | "dark"

const STORAGE_KEY = "resumate-theme"
const CHANGE_EVENT = "resumate:theme-changed"
const DARK_QUERY = "(prefers-color-scheme: dark)"

/** Inline in the root layout <head>. Keep in sync with applyTheme(). */
export const THEME_SCRIPT = `(function(){var k="${STORAGE_KEY}",m=window.matchMedia("${DARK_QUERY}");function p(){try{return localStorage.getItem(k)}catch(e){return null}}function a(){var t=p(),d=t==="dark"||(t!=="light"&&m.matches),r=document.documentElement;r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light"}a();m.addEventListener("change",a)})()`

function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === "light" || v === "dark" ? v : "system"
  } catch {
    return "system"
  }
}

function applyTheme(pref: ThemePreference) {
  const dark = pref === "dark" || (pref === "system" && window.matchMedia(DARK_QUERY).matches)
  const root = document.documentElement
  root.classList.toggle("dark", dark)
  root.style.colorScheme = dark ? "dark" : "light"
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange)
  window.addEventListener("storage", onChange)
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange)
    window.removeEventListener("storage", onChange)
  }
}

export function useTheme(): { theme: ThemePreference; setTheme: (t: ThemePreference) => void } {
  const theme = React.useSyncExternalStore(subscribe, readPreference, () => "system" as const)
  const setTheme = React.useCallback((t: ThemePreference) => {
    try {
      if (t === "system") localStorage.removeItem(STORAGE_KEY)
      else localStorage.setItem(STORAGE_KEY, t)
    } catch {
      // storage blocked: still switch for this page view
    }
    applyTheme(t)
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }, [])
  return { theme, setTheme }
}

function subscribeResolved(onChange: () => void) {
  const unsubscribe = subscribe(onChange)
  const media = window.matchMedia(DARK_QUERY)
  media.addEventListener("change", onChange)
  return () => {
    unsubscribe()
    media.removeEventListener("change", onChange)
  }
}

/** The theme actually shown: "system" resolved against the OS setting. */
export function useResolvedTheme(): "light" | "dark" {
  const pref = useTheme().theme
  const osDark = React.useSyncExternalStore(
    subscribeResolved,
    () => window.matchMedia(DARK_QUERY).matches,
    () => false
  )
  return pref === "dark" || (pref === "system" && osDark) ? "dark" : "light"
}
