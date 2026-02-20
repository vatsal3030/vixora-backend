import ApiError from "../utils/ApiError.js";

const DEFAULT_MODEL_CANDIDATES = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-flash-latest",
  "gemini-2.0-flash-001",
  "gemini-2.5-flash-lite",
];
const MAX_INPUT_CHARS = 8000;
const DEFAULT_MAX_OUTPUT_CHARS = 2000;
const HARD_MAX_OUTPUT_CHARS = 8000;

const normalizeText = (value) => String(value ?? "").trim();

const trimTo = (value, maxLength) => {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
};

const cleanEnv = (value) => {
  if (value === undefined || value === null) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1).trim();
  }
  return raw;
};

const toUniqueList = (values) => {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
};

const parsePositiveInt = (value, fallbackValue) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackValue;
  return Math.floor(parsed);
};

const parseModelCandidates = () => {
  const raw = cleanEnv(process.env.GEMINI_MODELS);
  if (!raw) return DEFAULT_MODEL_CANDIDATES;

  const values = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (values.length === 0) return DEFAULT_MODEL_CANDIDATES;

  // Keep configured order first, but always append known-good fallbacks.
  return toUniqueList([...values, ...DEFAULT_MODEL_CANDIDATES]);
};

const geminiApiKey = cleanEnv(process.env.GEMINI_API_KEY);
const modelCandidates = parseModelCandidates();
const geminiBaseUrl = "https://generativelanguage.googleapis.com/v1beta/models";
const configuredMaxOutputChars = parsePositiveInt(
  process.env.AI_MAX_OUTPUT_CHARS,
  DEFAULT_MAX_OUTPUT_CHARS
);
const MAX_OUTPUT_CHARS = Math.min(configuredMaxOutputChars, HARD_MAX_OUTPUT_CHARS);

const isRetryableGeminiStatus = (status) => status === 404 || status === 429 || status >= 500;

const parseGeminiResponseText = (payload) => {
  const candidate = payload?.candidates?.[0];
  if (!candidate) return "";

  const parts = candidate?.content?.parts;
  if (!Array.isArray(parts)) return "";

  const text = parts
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("\n")
    .trim();

  return trimTo(text, MAX_OUTPUT_CHARS);
};

const normalizeWords = (text) =>
  String(text || "")
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9]/g, ""))
    .filter(Boolean);

const reduceRepetitiveText = (text) => {
  const normalized = trimTo(text, 1200);
  if (!normalized) return "";

  const words = normalizeWords(normalized);
  if (words.length < 8) return normalized;

  const uniqueRatio = new Set(words).size / words.length;
  if (uniqueRatio >= 0.4) return normalized;

  return "";
};

const callGeminiModel = async ({
  model,
  systemInstruction,
  userPrompt,
  temperature = 0.4,
  maxOutputTokens = 500,
}) => {
  const requestBody = {
    system_instruction: systemInstruction
      ? {
          parts: [{ text: trimTo(systemInstruction, MAX_INPUT_CHARS) }],
        }
      : undefined,
    contents: [
      {
        role: "user",
        parts: [{ text: trimTo(userPrompt, MAX_INPUT_CHARS) }],
      },
    ],
    generationConfig: {
      temperature,
      maxOutputTokens,
    },
  };

  const response = await fetch(
    `${geminiBaseUrl}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(
      geminiApiKey
    )}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(requestBody),
    }
  );

  if (!response.ok) {
    let errorPayload = null;
    try {
      errorPayload = await response.json();
    } catch {
      errorPayload = null;
    }

    const message =
      errorPayload?.error?.message ||
      `Gemini request failed with status ${response.status}`;

    return {
      ok: false,
      retryable: isRetryableGeminiStatus(response.status),
      message,
      status: response.status,
      model,
    };
  }

  const payload = await response.json();
  const text = parseGeminiResponseText(payload);

  if (!text) {
    return {
      ok: false,
      retryable: true,
      status: 502,
      model,
      message: "Gemini returned empty response",
    };
  }

  return {
    ok: true,
    model,
    text,
  };
};

const fallbackSummary = ({ title, description }) => {
  const safeTitle = trimTo(title, 120);
  const safeDescription = reduceRepetitiveText(description);

  if (!safeDescription) {
    return `Summary for "${safeTitle}": Limited context is available (no strong transcript/description). Add a detailed description or transcript for a better summary.`;
  }

  return `Summary for "${safeTitle}": ${safeDescription}`;
};

const fallbackAnswer = ({ question, title, summary }) => {
  const safeQuestion = trimTo(question, 240);
  const safeTitle = trimTo(title, 120);
  const safeSummary = reduceRepetitiveText(summary);

  return trimTo(
    safeSummary
      ? `Based on available metadata for "${safeTitle}": ${safeSummary}. Question asked: "${safeQuestion}".`
      : `I can only see limited metadata for "${safeTitle}" right now (no useful transcript context). Please ask video-specific questions after transcript/description is improved.`,
    MAX_OUTPUT_CHARS
  );
};

export const isAiConfigured = () => Boolean(geminiApiKey);

export const generateAiText = async ({
  systemInstruction,
  userPrompt,
  temperature = 0.4,
  maxOutputTokens = 500,
  fallbackText = "",
}) => {
  if (!normalizeText(userPrompt)) {
    throw new ApiError(400, "AI prompt is required");
  }

  if (!isAiConfigured()) {
    return {
      text: trimTo(fallbackText, MAX_OUTPUT_CHARS),
      provider: "fallback",
      model: "none",
      warning: "GEMINI_API_KEY is missing or empty at runtime",
    };
  }

  let lastError = null;

  for (const model of modelCandidates) {
    const result = await callGeminiModel({
      model,
      systemInstruction,
      userPrompt,
      temperature,
      maxOutputTokens,
    });

    if (result.ok) {
      return {
        text: result.text,
        provider: "gemini",
        model: result.model,
      };
    }

    lastError = result;
    if (!result.retryable) {
      break;
    }
  }

  if (normalizeText(fallbackText)) {
    return {
      text: trimTo(fallbackText, MAX_OUTPUT_CHARS),
      provider: "fallback",
      model: "none",
      warning: lastError?.message,
    };
  }

  throw new ApiError(502, lastError?.message || "AI provider unavailable");
};

export const buildSummaryFallback = fallbackSummary;
export const buildAnswerFallback = fallbackAnswer;
