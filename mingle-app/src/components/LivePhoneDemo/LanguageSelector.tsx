"use client";

import { useRef, useEffect, useMemo, type RefObject } from "react";

const LANGUAGES = [
  { code: "en", flag: "🇺🇸", englishName: "English" },
  { code: "ko", flag: "🇰🇷", englishName: "Korean" },
  { code: "ja", flag: "🇯🇵", englishName: "Japanese" },
  { code: "zh", flag: "🇨🇳", englishName: "Chinese" },
  { code: "es", flag: "🇪🇸", englishName: "Spanish" },
  { code: "fr", flag: "🇫🇷", englishName: "French" },
  { code: "de", flag: "🇩🇪", englishName: "German" },
  { code: "ru", flag: "🇷🇺", englishName: "Russian" },
  { code: "pt", flag: "🇧🇷", englishName: "Portuguese" },
  { code: "ar", flag: "🇸🇦", englishName: "Arabic" },
  { code: "hi", flag: "🇮🇳", englishName: "Hindi" },
  { code: "th", flag: "🇹🇭", englishName: "Thai" },
  { code: "vi", flag: "🇻🇳", englishName: "Vietnamese" },
  { code: "it", flag: "🇮🇹", englishName: "Italian" },
  { code: "id", flag: "🇮🇩", englishName: "Indonesian" },
];

const SORTED_LANGUAGES = [...LANGUAGES].sort((a, b) => {
  if (a.code === "en") return -1;
  if (b.code === "en") return 1;
  return a.englishName.localeCompare(b.englishName, "en", {
    sensitivity: "base",
  });
});

const MAX_LANGS = 5;
const MIN_LANGS = 1;

interface LanguageSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  selectedLanguages: string[];
  onToggleLanguage: (code: string) => void;
  disabled?: boolean;
  triggerRef?: RefObject<HTMLElement | null>;
}

export default function LanguageSelector({
  isOpen,
  onClose,
  selectedLanguages,
  onToggleLanguage,
  disabled,
  triggerRef,
}: LanguageSelectorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const userLocale = useMemo(() => {
    if (typeof window === "undefined") return "en";
    const browserLocale = (
      window.navigator.languages?.find(Boolean) ||
      window.navigator.language ||
      document.documentElement.lang ||
      "en"
    ).trim();
    return browserLocale || "en";
  }, []);

  const languageNameFormatter = useMemo(() => {
    try {
      return new Intl.DisplayNames([userLocale], { type: "language" });
    } catch {
      try {
        return new Intl.DisplayNames(["en"], { type: "language" });
      } catch {
        return null;
      }
    }
  }, [userLocale]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (ref.current?.contains(target)) return;
      if (triggerRef?.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen, onClose, triggerRef]);

  if (!isOpen) return null;

  const atMax = selectedLanguages.length >= MAX_LANGS;
  const atMin = selectedLanguages.length <= MIN_LANGS;

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-xl py-1.5 w-44 max-h-[280px] overflow-y-auto"
    >
      {SORTED_LANGUAGES.map((lang) => {
        const isSelected = selectedLanguages.includes(lang.code);
        const isDisabled =
          disabled || (!isSelected && atMax) || (isSelected && atMin);
        const localizedName =
          languageNameFormatter?.of(lang.code)?.trim() || lang.englishName;
        return (
          <button
            key={lang.code}
            onClick={() => !isDisabled && onToggleLanguage(lang.code)}
            disabled={isDisabled}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
              isDisabled && !isSelected
                ? "opacity-40 cursor-not-allowed"
                : isDisabled && isSelected
                  ? "opacity-70 cursor-not-allowed"
                  : "hover:bg-gray-50"
            }`}
          >
            <span
              className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] ${
                isSelected
                  ? "bg-amber-500 border-amber-500 text-white"
                  : "border-gray-300"
              }`}
            >
              {isSelected && "✓"}
            </span>
            <span>{lang.flag}</span>
            <span className="text-gray-700 truncate">{localizedName}</span>
          </button>
        );
      })}
    </div>
  );
}
