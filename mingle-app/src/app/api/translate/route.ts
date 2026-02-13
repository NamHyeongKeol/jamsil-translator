import { NextResponse } from "next/server";
import { runTranslationPipeline } from "@/lib/translator";

type TranslateRequest = {
  text?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
};

export async function POST(request: Request) {
  let payload: TranslateRequest;

  try {
    payload = (await request.json()) as TranslateRequest;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const text = payload.text?.trim() ?? "";
  const sourceLanguage = payload.sourceLanguage?.trim() || "auto";
  const targetLanguage = payload.targetLanguage?.trim() || "en";

  if (!text) {
    return NextResponse.json(
      { error: "Text is required." },
      { status: 400 },
    );
  }

  const result = await runTranslationPipeline({
    text,
    sourceLanguage,
    targetLanguage,
  });

  return NextResponse.json({
    sourceLanguage: result.detectedLanguage,
    targetLanguage,
    translatedText: result.translatedText,
    provider: result.provider,
  });
}
