export type SttLanguageOption = {
  code: string
  englishName: string
  flag: string
}

export const DEFAULT_STT_LANGUAGES = ['en', 'ko', 'ja'] as const

export const STT_LANGUAGE_OPTIONS: SttLanguageOption[] = [
  { code: 'af', englishName: 'Afrikaans', flag: '🇿🇦' },
  { code: 'sq', englishName: 'Albanian', flag: '🇦🇱' },
  { code: 'ar', englishName: 'Arabic', flag: '🇸🇦' },
  { code: 'az', englishName: 'Azerbaijani', flag: '🇦🇿' },
  { code: 'eu', englishName: 'Basque', flag: '🇪🇸' },
  { code: 'be', englishName: 'Belarusian', flag: '🇧🇾' },
  { code: 'bn', englishName: 'Bengali', flag: '🇧🇩' },
  { code: 'bs', englishName: 'Bosnian', flag: '🇧🇦' },
  { code: 'bg', englishName: 'Bulgarian', flag: '🇧🇬' },
  { code: 'ca', englishName: 'Catalan', flag: '🇪🇸' },
  { code: 'zh', englishName: 'Chinese', flag: '🇨🇳' },
  { code: 'hr', englishName: 'Croatian', flag: '🇭🇷' },
  { code: 'cs', englishName: 'Czech', flag: '🇨🇿' },
  { code: 'da', englishName: 'Danish', flag: '🇩🇰' },
  { code: 'nl', englishName: 'Dutch', flag: '🇳🇱' },
  { code: 'en', englishName: 'English', flag: '🇺🇸' },
  { code: 'et', englishName: 'Estonian', flag: '🇪🇪' },
  { code: 'fi', englishName: 'Finnish', flag: '🇫🇮' },
  { code: 'fr', englishName: 'French', flag: '🇫🇷' },
  { code: 'gl', englishName: 'Galician', flag: '🇪🇸' },
  { code: 'de', englishName: 'German', flag: '🇩🇪' },
  { code: 'el', englishName: 'Greek', flag: '🇬🇷' },
  { code: 'gu', englishName: 'Gujarati', flag: '🇮🇳' },
  { code: 'he', englishName: 'Hebrew', flag: '🇮🇱' },
  { code: 'hi', englishName: 'Hindi', flag: '🇮🇳' },
  { code: 'hu', englishName: 'Hungarian', flag: '🇭🇺' },
  { code: 'id', englishName: 'Indonesian', flag: '🇮🇩' },
  { code: 'it', englishName: 'Italian', flag: '🇮🇹' },
  { code: 'ja', englishName: 'Japanese', flag: '🇯🇵' },
  { code: 'kn', englishName: 'Kannada', flag: '🇮🇳' },
  { code: 'kk', englishName: 'Kazakh', flag: '🇰🇿' },
  { code: 'ko', englishName: 'Korean', flag: '🇰🇷' },
  { code: 'lv', englishName: 'Latvian', flag: '🇱🇻' },
  { code: 'lt', englishName: 'Lithuanian', flag: '🇱🇹' },
  { code: 'mk', englishName: 'Macedonian', flag: '🇲🇰' },
  { code: 'ms', englishName: 'Malay', flag: '🇲🇾' },
  { code: 'ml', englishName: 'Malayalam', flag: '🇮🇳' },
  { code: 'mr', englishName: 'Marathi', flag: '🇮🇳' },
  { code: 'no', englishName: 'Norwegian', flag: '🇳🇴' },
  { code: 'fa', englishName: 'Persian', flag: '🇮🇷' },
  { code: 'pl', englishName: 'Polish', flag: '🇵🇱' },
  { code: 'pt', englishName: 'Portuguese', flag: '🇵🇹' },
  { code: 'pa', englishName: 'Punjabi', flag: '🇮🇳' },
  { code: 'ro', englishName: 'Romanian', flag: '🇷🇴' },
  { code: 'ru', englishName: 'Russian', flag: '🇷🇺' },
  { code: 'sr', englishName: 'Serbian', flag: '🇷🇸' },
  { code: 'sk', englishName: 'Slovak', flag: '🇸🇰' },
  { code: 'sl', englishName: 'Slovenian', flag: '🇸🇮' },
  { code: 'es', englishName: 'Spanish', flag: '🇪🇸' },
  { code: 'sw', englishName: 'Swahili', flag: '🇹🇿' },
  { code: 'sv', englishName: 'Swedish', flag: '🇸🇪' },
  { code: 'tl', englishName: 'Tagalog', flag: '🇵🇭' },
  { code: 'ta', englishName: 'Tamil', flag: '🇮🇳' },
  { code: 'te', englishName: 'Telugu', flag: '🇮🇳' },
  { code: 'th', englishName: 'Thai', flag: '🇹🇭' },
  { code: 'tr', englishName: 'Turkish', flag: '🇹🇷' },
  { code: 'uk', englishName: 'Ukrainian', flag: '🇺🇦' },
  { code: 'ur', englishName: 'Urdu', flag: '🇵🇰' },
  { code: 'vi', englishName: 'Vietnamese', flag: '🇻🇳' },
  { code: 'cy', englishName: 'Welsh', flag: '🇬🇧' },
]

export const STT_LANGUAGE_CODES = STT_LANGUAGE_OPTIONS.map(({ code }) => code)

export const STT_LANGUAGE_NAME_MAP: Record<string, string> = Object.fromEntries(
  STT_LANGUAGE_OPTIONS.map(({ code, englishName }) => [code, englishName]),
)
