export type DeepgramStreamingLanguage = {
    model: 'nova-2' | 'nova-3';
    providerCode: string;
};

export const SUPPORTED_STT_LANGUAGE_CODES = [
    'af', 'sq', 'ar', 'az', 'eu', 'be', 'bn', 'bs', 'bg', 'ca',
    'zh', 'hr', 'cs', 'da', 'nl', 'en', 'et', 'fi', 'fr', 'gl',
    'de', 'el', 'gu', 'he', 'hi', 'hu', 'id', 'it', 'ja', 'kn',
    'kk', 'ko', 'lv', 'lt', 'mk', 'ms', 'ml', 'mr', 'no', 'fa',
    'pl', 'pt', 'pa', 'ro', 'ru', 'sr', 'sk', 'sl', 'es', 'sw',
    'sv', 'tl', 'ta', 'te', 'th', 'tr', 'uk', 'ur', 'vi', 'cy',
] as const;

const SUPPORTED_STT_LANGUAGE_SET = new Set<string>(SUPPORTED_STT_LANGUAGE_CODES);

const STT_LANGUAGE_ALIASES: Record<string, string> = {
    fil: 'tl',
    iw: 'he',
    nb: 'no',
    nn: 'no',
};

const DEEPGRAM_STREAMING_LANGUAGE_MAP: Record<string, DeepgramStreamingLanguage> = {
    ar: { model: 'nova-3', providerCode: 'ar' },
    be: { model: 'nova-3', providerCode: 'be' },
    bn: { model: 'nova-3', providerCode: 'bn' },
    bs: { model: 'nova-3', providerCode: 'bs' },
    bg: { model: 'nova-3', providerCode: 'bg' },
    ca: { model: 'nova-3', providerCode: 'ca' },
    zh: { model: 'nova-2', providerCode: 'zh' },
    hr: { model: 'nova-3', providerCode: 'hr' },
    cs: { model: 'nova-3', providerCode: 'cs' },
    da: { model: 'nova-3', providerCode: 'da' },
    nl: { model: 'nova-3', providerCode: 'nl' },
    en: { model: 'nova-3', providerCode: 'en-US' },
    et: { model: 'nova-3', providerCode: 'et' },
    fi: { model: 'nova-3', providerCode: 'fi' },
    fr: { model: 'nova-3', providerCode: 'fr' },
    gl: { model: 'nova-3', providerCode: 'gl' },
    de: { model: 'nova-3', providerCode: 'de' },
    el: { model: 'nova-3', providerCode: 'el' },
    he: { model: 'nova-3', providerCode: 'he' },
    hi: { model: 'nova-3', providerCode: 'hi' },
    hu: { model: 'nova-3', providerCode: 'hu' },
    id: { model: 'nova-3', providerCode: 'id' },
    it: { model: 'nova-3', providerCode: 'it' },
    ja: { model: 'nova-3', providerCode: 'ja' },
    kn: { model: 'nova-3', providerCode: 'kn' },
    ko: { model: 'nova-3', providerCode: 'ko' },
    lv: { model: 'nova-3', providerCode: 'lv' },
    lt: { model: 'nova-3', providerCode: 'lt' },
    mk: { model: 'nova-3', providerCode: 'mk' },
    ms: { model: 'nova-3', providerCode: 'ms' },
    mr: { model: 'nova-3', providerCode: 'mr' },
    no: { model: 'nova-3', providerCode: 'no' },
    fa: { model: 'nova-3', providerCode: 'fa' },
    pl: { model: 'nova-3', providerCode: 'pl' },
    pt: { model: 'nova-3', providerCode: 'pt-BR' },
    ro: { model: 'nova-3', providerCode: 'ro' },
    ru: { model: 'nova-3', providerCode: 'ru' },
    sr: { model: 'nova-3', providerCode: 'sr' },
    sk: { model: 'nova-3', providerCode: 'sk' },
    sl: { model: 'nova-3', providerCode: 'sl' },
    es: { model: 'nova-3', providerCode: 'es' },
    sv: { model: 'nova-3', providerCode: 'sv' },
    ta: { model: 'nova-3', providerCode: 'ta' },
    te: { model: 'nova-3', providerCode: 'te' },
    th: { model: 'nova-2', providerCode: 'th' },
    tr: { model: 'nova-3', providerCode: 'tr' },
    uk: { model: 'nova-3', providerCode: 'uk' },
    ur: { model: 'nova-3', providerCode: 'ur' },
    vi: { model: 'nova-3', providerCode: 'vi' },
};

const DEEPGRAM_MULTI_LANGUAGE_SET = new Set<string>([
    'en', 'es', 'fr', 'de', 'hi', 'ru', 'pt', 'ja', 'it', 'nl',
]);

function normalizeSttLanguageCode(raw: string): string {
    const normalized = raw.trim().replace(/_/g, '-').toLowerCase().split('-')[0] || '';
    if (!normalized) return '';
    return STT_LANGUAGE_ALIASES[normalized] || normalized;
}

export function sanitizeRequestedSttLanguages(rawLanguages: string[]): string[] {
    const sanitized: string[] = [];
    const seen = new Set<string>();

    for (const rawLanguage of rawLanguages) {
        if (typeof rawLanguage !== 'string') continue;
        const normalized = normalizeSttLanguageCode(rawLanguage);
        if (!normalized || seen.has(normalized) || !SUPPORTED_STT_LANGUAGE_SET.has(normalized)) continue;
        sanitized.push(normalized);
        seen.add(normalized);
    }

    return sanitized.length > 0 ? sanitized : ['en'];
}

export function resolveDeepgramStreamingLanguage(rawLanguage: string): DeepgramStreamingLanguage | null {
    const normalized = normalizeSttLanguageCode(rawLanguage);
    return DEEPGRAM_STREAMING_LANGUAGE_MAP[normalized] || null;
}

export function getUnsupportedDeepgramMultilingualLanguages(rawLanguages: string[]): string[] {
    const unsupported: string[] = [];
    const seen = new Set<string>();

    for (const rawLanguage of rawLanguages) {
        const normalized = normalizeSttLanguageCode(rawLanguage);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        if (!DEEPGRAM_MULTI_LANGUAGE_SET.has(normalized)) {
            unsupported.push(normalized);
        }
    }

    return unsupported;
}

export function resolveFireworksLanguage(rawLanguage: string): string {
    const normalized = normalizeSttLanguageCode(rawLanguage);
    if (SUPPORTED_STT_LANGUAGE_SET.has(normalized)) return normalized;
    return 'en';
}
