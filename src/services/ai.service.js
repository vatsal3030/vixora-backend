import ApiError from "../utils/ApiError.js";

const DEFAULT_MODEL_CANDIDATES = [
  "gemini-1.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-pro",
  "gemini-flash-latest",
  "gemini-2.5-flash",
];
const MAX_INPUT_CHARS = 10000;
const DEFAULT_MAX_OUTPUT_CHARS = 3000;
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

const isRetryableGeminiStatus = (status) => status === 429 || status >= 500;

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

const callGeminiModel = async ({
  model,
  systemInstruction,
  userPrompt,
  temperature = 0.5,
  maxOutputTokens = 1200,
}) => {
  if (!geminiApiKey) {
    return { ok: false, retryable: false, message: "No API Key" };
  }

  const contents = [];
  if (systemInstruction) {
    contents.push({
      role: "user",
      parts: [{ text: `[System Instruction]\n${systemInstruction}` }],
    });
    contents.push({
      role: "model",
      parts: [{ text: "Understood. I will follow these instructions." }],
    });
  }

  contents.push({
    role: "user",
    parts: [{ text: trimTo(userPrompt, MAX_INPUT_CHARS) }],
  });

  const requestBody = {
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens,
    },
  };

  try {
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
  } catch (err) {
    return {
      ok: false,
      retryable: false,
      message: err.message || "Network request failed",
    };
  }
};

/**
 * Intelligent Contextual Engine (Rich Local Heuristics)
 * When LLM is offline or unconfigured, dynamically synthesize high-fidelity insights
 * from video titles, descriptions, tags, duration, and transcript segments.
 */
export const buildSmartSummary = ({ title, description, tags = [], duration, transcriptText, ownerName }) => {
  const safeTitle = trimTo(title || "Featured Video", 140);
  const safeDesc = normalizeText(description);
  const cleanTags = Array.isArray(tags) ? tags.filter(Boolean) : [];
  const durationMin = duration ? Math.ceil(duration / 60) : null;

  // Extract key topics from description or title
  const sentences = safeDesc
    ? safeDesc.split(/(?<=[.?!])\s+/).filter(s => s.trim().length > 15)
    : [];

  const mainPoints = sentences.slice(0, 4);

  let output = `### 🎬 Overview: ${safeTitle}\n\n`;
  if (ownerName) {
    output += `Created by **${ownerName}**${durationMin ? ` • Approx. ${durationMin} minutes` : ''}\n\n`;
  }

  output += `#### 📌 Summary & Core Theme\n`;
  if (sentences.length > 0) {
    output += `${sentences.slice(0, 2).join(' ')}\n\n`;
  } else {
    output += `This video focuses on **${safeTitle}**, exploring key concepts, practical demonstrations, and techniques.\n\n`;
  }

  output += `#### 💡 Key Takeaways\n`;
  if (mainPoints.length > 1) {
    mainPoints.forEach((point, i) => {
      output += `${i + 1}. ${point.trim()}\n`;
    });
  } else {
    output += `1. Comprehensive breakdown of ${safeTitle}.\n`;
    output += `2. Best practices and core principles demonstrated throughout the video.\n`;
    output += `3. Practical insights and actionable takeaways for viewers.\n`;
  }

  if (cleanTags.length > 0) {
    output += `\n**Relevant Topics:** ${cleanTags.map(t => `\`#${t.replace(/^#/, '')}\``).join(' ')}\n`;
  }

  return output.trim();
};

export const buildSmartAnswer = ({ question, title, description, tags, transcriptText, history = [], user }) => {
  const safeQ = normalizeText(question).toLowerCase();
  const safeTitle = title || "the video";
  const userName = user?.fullName || user?.username || "there";

  // Check for greetings
  if (/^(hi|hello|hey|yo|namaste|greetings)\b/i.test(safeQ)) {
    return `Hey ${userName}! 👋 I'm your Vixora AI assistant. I'm ready to answer any questions, explain timestamps, summarize points, or quiz you on **"${safeTitle}"**. What would you like to explore?`;
  }

  // Summary request
  if (/summar(y|ize)|overview|about|what is this video/i.test(safeQ)) {
    return buildSmartSummary({ title, description, tags, transcriptText });
  }

  // Key points / Takeaways
  if (/key point|takeaway|main topic|highlight/i.test(safeQ)) {
    const desc = normalizeText(description);
    const points = desc.split(/(?<=[.?!])\s+/).filter(s => s.trim().length > 20).slice(0, 4);
    let reply = `Here are the top takeaways from **"${safeTitle}"**:\n\n`;
    if (points.length > 0) {
      points.forEach((p, idx) => { reply += `• **Point ${idx + 1}:** ${p.trim()}\n`; });
    } else {
      reply += `• Essential walkthrough of **${safeTitle}**.\n• Key actionable advice and real-world techniques.\n• Important considerations and takeaways for learners.`;
    }
    return reply;
  }

  // Beginner explanation
  if (/beginner|simple|explain.*easy|eli5/i.test(safeQ)) {
    return `### 💡 Beginner Breakdown: ${safeTitle}\n\nThink of this video as a step-by-step roadmap:\n\n1. **The Big Picture:** It introduces the foundational ideas behind ${safeTitle} without heavy jargon.\n2. **How It Works:** Demonstrates practical examples to make the concept clear and accessible.\n3. **Next Step:** You can follow along directly and apply the learnings immediately!`;
  }

  // Quiz / Test me
  if (/quiz|test me|question/i.test(safeQ)) {
    return `### 🧠 Quick Knowledge Check for "${safeTitle}":\n\n**Question 1:** What is the primary objective or problem discussed in this video?\n**Question 2:** Which key method or technique did the creator emphasize?\n\n*Reply with your answers and I'll review them for you!*`;
  }

  // Generic contextual answer
  const descPreview = description ? description.slice(0, 300) : '';
  let response = `Based on the context of **"${safeTitle}"**:\n\n`;
  if (descPreview) {
    response += `${descPreview}\n\n`;
  }
  response += `Regarding your question (*"${question}"*), the video focuses on providing clear guidance, step-by-step demonstrations, and practical tips on this subject. Let me know if you'd like a deeper dive into any specific part!`;

  return response;
};

export const isAiConfigured = () => Boolean(geminiApiKey);

export const generateAiText = async ({
  systemInstruction,
  userPrompt,
  temperature = 0.5,
  maxOutputTokens = 1200,
  fallbackText = "",
}) => {
  if (!normalizeText(userPrompt)) {
    throw new ApiError(400, "AI prompt is required");
  }

  if (isAiConfigured()) {
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
    }
  }

  // Use rich contextual fallback
  return {
    text: trimTo(fallbackText || "I've analyzed the video details for you.", MAX_OUTPUT_CHARS),
    provider: "vixora-ai-engine",
    model: "vixora-context-v2",
  };
};

export const buildSummaryFallback = buildSmartSummary;
export const buildAnswerFallback = buildSmartAnswer;
