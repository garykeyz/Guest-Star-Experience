import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { JsonObject } from "./d1-store";

export const GUEST_LANGUAGE_CODES = ["es", "en", "fr", "it", "de", "ru", "pt"] as const;
export type GuestLanguageCode = typeof GUEST_LANGUAGE_CODES[number];

export const BRANDING_MESSAGE_FIELDS = [
  "welcomeMessage",
  "activityEndingMessage",
  "upcomingActivityMessage",
  "reviewInvitationMessage",
  "generalReviewMessage",
  "beforeStartClosedTitle",
  "beforeStartClosedMessage",
  "beforeStartOpenTitle",
  "beforeStartOpenMessage",
  "inProgressTitle",
  "inProgressMessage",
  "requestsClosedTitle",
  "requestsClosedMessage",
  "activityFinishedTitle",
  "activityFinishedMessage",
  "noActivityTitle",
  "noActivityMessage"
] as const;

export type LocalizedMessages = Record<GuestLanguageCode, Record<string, string>>;

type WorkersAiBinding = {
  run(model: string, input: {
    text: string;
    source_lang: string;
    target_lang: string;
  }): Promise<unknown>;
};

const TRANSLATION_MODEL = "@cf/meta/m2m100-1.2b";
const TRANSLATION_SEPARATOR = "\n\n<<<94721001>>>\n\n";
const MESSAGE_PLACEHOLDERS = [
  ["{hotel_name}", "<<<94721002>>>"] ,
  ["{activity_name}", "<<<94721003>>>"] ,
  ["{venue_name}", "<<<94721004>>>"]
] as const;

function cleanText(value: unknown, maximum = 300) {
  return String(value ?? "").trim().slice(0, maximum);
}

function protectedMessage(message: string) {
  return MESSAGE_PLACEHOLDERS.reduce(
    (output, [placeholder, token]) => output.replaceAll(placeholder, token),
    message
  );
}

function restoredMessage(message: string, original: string) {
  let output = message;
  const required: string[] = [];
  for (const [placeholder, token] of MESSAGE_PLACEHOLDERS) {
    if (!original.includes(placeholder)) continue;
    required.push(placeholder);
    output = output.replaceAll(token, placeholder);
    if (!output.includes(placeholder)) output = `${output} ${placeholder}`.trim();
  }
  const normalized = String(output || "").trim();
  if (normalized.length <= 300) return normalized;
  const suffix = required.join(" ");
  if (!suffix) return cleanText(normalized);
  const prose = required.reduce(
    (value, placeholder) => value.replaceAll(placeholder, ""),
    normalized
  ).replace(/\s+/g, " ").trim();
  return `${prose.slice(0, Math.max(0, 299 - suffix.length)).trim()} ${suffix}`.trim();
}

export function estimateBrandingTranslationNeurons(rawBranding: unknown) {
  if (!rawBranding || typeof rawBranding !== "object" || Array.isArray(rawBranding)) return 1;
  const branding = rawBranding as Record<string, unknown>;
  const characters = BRANDING_MESSAGE_FIELDS.reduce(
    (total, field) => total + cleanText(branding[field]).length,
    0
  );
  // Conservative allowance: one token per two characters, equal-size output,
  // six target languages, and one complete retry if a combined response cannot
  // be split. m2m100 is billed at 0.03105 neurons per token on each side.
  return Math.max(1, Math.ceil(characters * 0.3726 + 25));
}

function isLanguageCode(value: unknown): value is GuestLanguageCode {
  return GUEST_LANGUAGE_CODES.includes(String(value || "") as GuestLanguageCode);
}

function emptyLocalizedMessages(): LocalizedMessages {
  return Object.fromEntries(GUEST_LANGUAGE_CODES.map((code) => [code, {}])) as LocalizedMessages;
}

export function parseLocalizedMessages(value: unknown): LocalizedMessages {
  let source: unknown = value;
  if (typeof source === "string") {
    try { source = JSON.parse(source || "{}"); }
    catch { source = {}; }
  }
  const localized = emptyLocalizedMessages();
  if (!source || typeof source !== "object" || Array.isArray(source)) return localized;
  for (const code of GUEST_LANGUAGE_CODES) {
    const messages = (source as Record<string, unknown>)[code];
    if (!messages || typeof messages !== "object" || Array.isArray(messages)) continue;
    for (const field of BRANDING_MESSAGE_FIELDS) {
      const message = cleanText((messages as Record<string, unknown>)[field]);
      if (message) localized[code][field] = message;
    }
  }
  return localized;
}

export function getWorkersAiBinding(): WorkersAiBinding | null {
  try {
    const context = getCloudflareContext();
    const env = context.env as unknown as Record<string, unknown>;
    const ai = env.AI as WorkersAiBinding | undefined;
    return ai && typeof ai.run === "function" ? ai : null;
  } catch {
    return null;
  }
}

function translatedText(response: unknown) {
  if (!response || typeof response !== "object") return "";
  const record = response as Record<string, unknown>;
  if (typeof record.translated_text === "string") return record.translated_text.trim();
  const result = record.result;
  return result && typeof result === "object" && typeof (result as Record<string, unknown>).translated_text === "string"
    ? String((result as Record<string, unknown>).translated_text).trim()
    : "";
}

async function translateMessages(
  ai: WorkersAiBinding,
  messages: string[],
  sourceLanguage: GuestLanguageCode,
  targetLanguage: GuestLanguageCode
) {
  if (!messages.length) return [];
  const protectedMessages = messages.map(protectedMessage);
  const combined = protectedMessages.join(TRANSLATION_SEPARATOR);
  const response = await ai.run(TRANSLATION_MODEL, {
    text: combined,
    source_lang: sourceLanguage,
    target_lang: targetLanguage
  });
  const translated = translatedText(response);
  const split = translated.split(TRANSLATION_SEPARATOR).map((message, index) =>
    restoredMessage(message, messages[index] || "")
  );
  if (split.length === messages.length && split.every(Boolean)) return split;

  return await Promise.all(messages.map(async (message) => {
    const item = await ai.run(TRANSLATION_MODEL, {
      text: protectedMessage(message),
      source_lang: sourceLanguage,
      target_lang: targetLanguage
    });
    const result = restoredMessage(translatedText(item), message);
    if (!result) throw new Error("TRANSLATION_EMPTY");
    return result;
  }));
}

export async function prepareBrandingLocalization(
  rawBranding: unknown,
  ai: WorkersAiBinding | null
): Promise<{ branding: JsonObject; warning: string }> {
  const branding = rawBranding && typeof rawBranding === "object" && !Array.isArray(rawBranding)
    ? { ...(rawBranding as JsonObject) }
    : {};
  for (const field of BRANDING_MESSAGE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(branding, field)) branding[field] = cleanText(branding[field]);
  }
  const sourceLanguage = isLanguageCode(branding.messageSourceLanguage)
    ? branding.messageSourceLanguage
    : "en";
  const mode = String(branding.translationMode || "auto") === "manual" ? "manual" : "auto";
  branding.messageSourceLanguage = sourceLanguage;
  branding.translationMode = mode;

  if (mode === "manual") {
    const localized = parseLocalizedMessages(branding.localizedMessagesJson);
    for (const field of BRANDING_MESSAGE_FIELDS) {
      const original = cleanText(branding[field]);
      if (original) localized[sourceLanguage][field] = original;
    }
    branding.localizedMessagesJson = JSON.stringify(localized);
    branding.translationStatus = "manual";
    branding.translatedAt = new Date().toISOString();
    return { branding, warning: "" };
  }

  if (!ai) {
    delete branding.localizedMessagesJson;
    branding.translationStatus = "manual_required";
    branding.translatedAt = "";
    return {
      branding,
      warning: "Free automatic translation is temporarily unavailable. Existing translations were preserved; use the manual language fields if needed."
    };
  }

  const fields = BRANDING_MESSAGE_FIELDS.filter((field) => cleanText(branding[field]));
  const originals = fields.map((field) => cleanText(branding[field]));
  const localized = emptyLocalizedMessages();
  fields.forEach((field, index) => { localized[sourceLanguage][field] = originals[index]; });

  try {
    await Promise.all(GUEST_LANGUAGE_CODES.filter((code) => code !== sourceLanguage).map(async (code) => {
      const translated = await translateMessages(ai, originals, sourceLanguage, code);
      fields.forEach((field, index) => { localized[code][field] = translated[index]; });
    }));
    branding.localizedMessagesJson = JSON.stringify(localized);
    branding.translationStatus = "automatic";
    branding.translatedAt = new Date().toISOString();
    return { branding, warning: "" };
  } catch {
    delete branding.localizedMessagesJson;
    branding.translationStatus = "manual_required";
    branding.translatedAt = "";
    return {
      branding,
      warning: "The free translation quota was unavailable. No paid translation was used; existing translations were preserved for manual editing."
    };
  }
}
