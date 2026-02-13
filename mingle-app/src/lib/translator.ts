export type TranslationProvider = "mock" | "openai";

export type TranslationResult = {
  translatedText: string;
  detectedLanguage: string;
  provider: TranslationProvider;
};

const KNOWN_TRANSLATIONS: Record<string, Record<string, string>> = {
  "hello": {
    ko: "안녕하세요",
    ja: "こんにちは",
    es: "hola",
  },
  "how are you?": {
    ko: "잘 지내세요?",
    ja: "お元気ですか？",
    es: "¿cómo estás?",
  },
  "안녕하세요": {
    en: "hello",
    ja: "こんにちは",
    es: "hola",
  },
  "고마워요": {
    en: "thank you",
    ja: "ありがとう",
    es: "gracias",
  },
  "오늘 만나서 반가웠어요": {
    en: "It was nice meeting you today.",
    ja: "今日は会えてうれしかったです。",
    es: "Me alegró conocerte hoy.",
  },
};

function detectByUnicode(text: string): string {
  if (/[가-힣]/.test(text)) {
    return "ko";
  }
  if (/[ぁ-んァ-ン]/.test(text)) {
    return "ja";
  }
  if (/[áéíóúñ¿¡]/i.test(text)) {
    return "es";
  }
  return "en";
}

function mockTranslate(text: string, targetLanguage: string): string {
  const normalized = text.trim().toLowerCase();
  const mapped = KNOWN_TRANSLATIONS[normalized]?.[targetLanguage];
  if (mapped) {
    return mapped;
  }
  return `[${targetLanguage}] ${text.trim()}`;
}

async function translateWithOpenAI(args: {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
}): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const model = process.env.OPENAI_TRANSLATION_MODEL ?? "gpt-4.1-mini";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content:
            "You are a translation engine. Return only the translated text with no explanation.",
        },
        {
          role: "user",
          content: `Translate from ${args.sourceLanguage} to ${args.targetLanguage}: ${args.text}`,
        },
      ],
      max_output_tokens: 400,
    }),
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as { output_text?: string };
  const output = payload.output_text?.trim();
  return output && output.length > 0 ? output : null;
}

export async function runTranslationPipeline(args: {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
}): Promise<TranslationResult> {
  const detectedLanguage =
    args.sourceLanguage === "auto" ? detectByUnicode(args.text) : args.sourceLanguage;

  const translatedFromOpenAI = await translateWithOpenAI({
    text: args.text,
    sourceLanguage: detectedLanguage,
    targetLanguage: args.targetLanguage,
  });

  if (translatedFromOpenAI) {
    return {
      translatedText: translatedFromOpenAI,
      detectedLanguage,
      provider: "openai",
    };
  }

  return {
    translatedText: mockTranslate(args.text, args.targetLanguage),
    detectedLanguage,
    provider: "mock",
  };
}
