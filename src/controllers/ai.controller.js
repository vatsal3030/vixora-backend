import prisma from "../db/prisma.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import { sanitizePagination } from "../utils/pagination.js";
import { buildPaginatedListData } from "../utils/listResponse.js";
import {
  buildAnswerFallback,
  buildSummaryFallback,
  generateAiText,
  isAiConfigured,
} from "../services/ai.service.js";
import {
  filterTranscriptSegments,
  parseTimeQueryToMs,
  parseTranscriptInput,
  resolveTranscriptForRead,
} from "../utils/transcript.js";

const MAX_SESSION_TITLE_LENGTH = 120;
const MAX_USER_MESSAGE_LENGTH = 1500;
const MAX_CONTEXT_MESSAGES = 8;
const MAX_TRANSCRIPT_CONTEXT_CHARS = 5000;
const MAX_TRANSCRIPT_INPUT_CHARS = 120000;
const MAX_SESSION_CACHE_LOOKBACK_MESSAGES = 40;
const DEFAULT_DAILY_AI_MESSAGES_LIMIT = 40;
const ALLOWED_TRANSCRIPT_SOURCES = new Set(["MANUAL", "AUTO", "IMPORTED"]);

const parsePositiveInt = (value, fallbackValue) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallbackValue;
};

const DAILY_AI_MESSAGES_LIMIT = parsePositiveInt(
  process.env.AI_DAILY_MESSAGE_LIMIT,
  DEFAULT_DAILY_AI_MESSAGES_LIMIT
);

const normalizeText = (value) => String(value ?? "").trim();

const parseBoolean = (value, defaultValue = false) => {
  if (value === undefined || value === null || value === "") return defaultValue;
  const normalized = String(value).toLowerCase().trim();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return defaultValue;
};

const trimTo = (value, maxLength) => {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
};

const tokenize = (value) =>
  normalizeText(value)
    .toLowerCase()
    .split(/\s+/)
    .map((part) => part.replace(/[^a-z0-9]/g, ""))
    .filter(Boolean);

const isLowInformationText = (value, minimumWords = 8) => {
  const words = tokenize(value);
  if (words.length < minimumWords) return !normalizeText(value);
  const uniqueRatio = new Set(words).size / words.length;
  return uniqueRatio < 0.4;
};

const sanitizeContextText = (value, maxLength) => {
  const text = trimTo(value, maxLength);
  if (!text) return "";
  return isLowInformationText(text) ? "" : text;
};

const GREETING_PATTERNS = [
  /^hi+$/i,
  /^hello+$/i,
  /^hey+$/i,
  /^yo+$/i,
  /^hola+$/i,
  /^namaste+$/i,
  /^good\s+(morning|afternoon|evening|night)$/i,
  /^how are you(\?)?$/i,
  /^thanks?(\s+you)?$/i,
  /^ok(ay)?$/i,
];
const CONTEXT_SOURCE_QUESTION_PATTERNS = [
  /\bdo you watch\b/i,
  /\bdid you watch\b/i,
  /\bhave you watched\b/i,
  /\bwatched this video\b/i,
  /\bdo you access\b/i,
  /\bdid you access\b/i,
  /\bhow do you know\b/i,
  /\bwhat context\b/i,
  /\bwhere did you get\b/i,
];

const isGreetingOrSmallTalk = (value) => {
  const text = normalizeText(value);
  if (!text) return false;
  if (text.length <= 16 && GREETING_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }

  return false;
};

const isContextSourceQuestion = (value) => {
  const text = normalizeText(value);
  if (!text) return false;
  return CONTEXT_SOURCE_QUESTION_PATTERNS.some((pattern) => pattern.test(text));
};

const buildChatContextMeta = ({ video, transcriptText }) => {
  const safeDescription = sanitizeContextText(video?.description, 3000);
  const safeSummary = sanitizeContextText(video?.summary, 1200);
  const transcriptChars = normalizeText(transcriptText).length;
  const hasTranscript = transcriptChars > 0;
  const hasDescription = Boolean(safeDescription);
  const hasSummary = Boolean(safeSummary);

  let quality = "MINIMAL";
  if (hasTranscript) quality = "RICH";
  else if (hasSummary || hasDescription) quality = "LIMITED";

  return {
    hasTranscript,
    transcriptChars,
    hasDescription,
    hasSummary,
    quality,
  };
};

const buildSmallTalkReply = ({ video, contextMeta }) => {
  if (!video) {
    return "Hi! I can help with Vixora workflows like uploads, playback, channel growth, and settings.";
  }

  if (contextMeta?.hasTranscript || contextMeta?.hasSummary || contextMeta?.hasDescription) {
    return `Hi! Ask me about "${trimTo(video.title, 80)}" and I will explain key points, summary, and beginner-friendly takeaways.`;
  }

  return `Hi! I can help, but this video has limited AI context right now. Add a richer description or transcript for better answers about "${trimTo(
    video.title,
    80
  )}".`;
};

const buildContextSourceReply = ({ video, contextMeta }) => {
  const source =
    contextMeta?.hasTranscript
      ? "transcript + metadata (title/description/summary)"
      : "metadata (title/description/summary)";

  if (!video) {
    return "I answer using the context provided in Vixora chat and platform data, not by directly watching raw video frames.";
  }

  return `I answer based on ${source} for "${trimTo(
    video.title,
    80
  )}". I do not directly watch raw video frames like a human viewer.`;
};

const buildVideoContextText = ({
  video,
  transcriptText,
  includeSummary = true,
}) => {
  const safeDescription = sanitizeContextText(video?.description, 3000);
  const safeSummary = sanitizeContextText(video?.summary, 1200);
  const safeTranscript = trimTo(transcriptText, MAX_TRANSCRIPT_CONTEXT_CHARS);

  const parts = [
    `Title: ${trimTo(video?.title, 200)}`,
    `Description: ${safeDescription || "Not available or too repetitive for reliable AI context."}`,
  ];

  if (includeSummary && safeSummary) {
    parts.push(`Existing summary: ${safeSummary}`);
  }

  if (safeTranscript) {
    parts.push(`Transcript excerpt: ${safeTranscript}`);
  } else {
    parts.push(
      "Transcript excerpt: Not available. Prefer best-effort answer from title/description and clearly mark uncertainty."
    );
  }

  return parts.join("\n");
};

const buildDefaultSessionTitle = (videoTitle) => {
  const safeVideoTitle = trimTo(videoTitle, 80);
  if (safeVideoTitle) {
    return `Chat about: ${safeVideoTitle}`;
  }
  return "General assistant chat";
};

const deriveSessionTitle = (session) => {
  const explicitTitle = trimTo(session?.title, MAX_SESSION_TITLE_LENGTH);
  if (explicitTitle) return explicitTitle;

  return buildDefaultSessionTitle(session?.video?.title);
};

const normalizeTranscriptSource = (value) => {
  const source = normalizeText(value).toUpperCase();
  if (!source) return "MANUAL";
  return ALLOWED_TRANSCRIPT_SOURCES.has(source) ? source : "MANUAL";
};

const parseNonNegativeNumber = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
};

const normalizeComparableText = (value) =>
  normalizeText(value).replace(/\s+/g, " ").toLowerCase();

const pickTranscriptContextForQuestion = ({
  transcriptText = "",
  transcriptSegments = [],
  question = "",
  maxChars = MAX_TRANSCRIPT_CONTEXT_CHARS,
}) => {
  const normalizedQuestion = normalizeComparableText(question);
  const normalizedTranscript = normalizeText(transcriptText);

  if (!normalizedTranscript && (!Array.isArray(transcriptSegments) || transcriptSegments.length === 0)) {
    return "";
  }

  if (!normalizedQuestion) {
    return trimTo(normalizedTranscript, maxChars);
  }

  const tokens = tokenize(normalizedQuestion).filter((token) => token.length > 2);

  if (!Array.isArray(transcriptSegments) || transcriptSegments.length === 0 || tokens.length === 0) {
    return trimTo(normalizedTranscript, maxChars);
  }

  const scored = transcriptSegments
    .map((segment, index) => {
      const text = normalizeText(segment?.text);
      if (!text) return null;

      const haystack = text.toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (haystack.includes(token)) score += 1;
      }

      return {
        index,
        score,
        text,
      };
    })
    .filter(Boolean);

  const positiveMatches = scored
    .filter((row) => row.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    })
    .slice(0, 16);

  if (positiveMatches.length === 0) {
    return trimTo(normalizedTranscript, maxChars);
  }

  const orderedUnique = [...positiveMatches]
    .sort((a, b) => a.index - b.index)
    .map((row) => row.text);

  const merged = trimTo(orderedUnique.join(" "), maxChars);
  return merged || trimTo(normalizedTranscript, maxChars);
};

const findSessionCachedReply = ({ orderedRecentMessages, incomingMessage }) => {
  if (!Array.isArray(orderedRecentMessages) || orderedRecentMessages.length < 2) {
    return null;
  }

  const normalizedIncoming = normalizeComparableText(incomingMessage);
  if (!normalizedIncoming) return null;

  for (let index = orderedRecentMessages.length - 2; index >= 0; index -= 1) {
    const current = orderedRecentMessages[index];
    const next = orderedRecentMessages[index + 1];

    if (!current || !next) continue;
    if (current.role !== "USER" || next.role !== "ASSISTANT") continue;

    if (normalizeComparableText(current.content) === normalizedIncoming) {
      return trimTo(next.content, 6000);
    }
  }

  return null;
};

const loadVideoForAi = async ({ videoId, viewerId }) => {
  const video = await prisma.video.findUnique({
    where: { id: videoId },
    select: {
      id: true,
      ownerId: true,
      title: true,
      description: true,
      duration: true,
      summary: true,
      isPublished: true,
      isDeleted: true,
      processingStatus: true,
      isHlsReady: true,
      transcript: {
        select: {
          transcript: true,
          segments: true,
          language: true,
          source: true,
          wordCount: true,
        },
      },
    },
  });

  if (!video || video.isDeleted) {
    throw new ApiError(404, "Video not found");
  }

  if (video.processingStatus !== "COMPLETED" || !video.isHlsReady) {
    throw new ApiError(400, "Video processing not completed");
  }

  const isOwner = viewerId === video.ownerId;
  if (!video.isPublished && !isOwner) {
    throw new ApiError(403, "Video is not publicly available");
  }

  const transcriptData = resolveTranscriptForRead({
    transcript: video?.transcript?.transcript || "",
    segments: video?.transcript?.segments || null,
    durationSeconds: video?.duration || null,
  });

  return {
    ...video,
    transcriptText: transcriptData.transcriptText,
    transcriptSegments: transcriptData.segments,
    transcriptMeta: {
      language: video?.transcript?.language || null,
      source: video?.transcript?.source || null,
      wordCount: video?.transcript?.wordCount || transcriptData.wordCount || 0,
      segmentCount: transcriptData.segmentCount || 0,
    },
  };
};

const ensureSessionOwnership = async ({ sessionId, userId }) => {
  const session = await prisma.aIChatSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      userId: true,
      videoId: true,
      title: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!session || session.userId !== userId) {
    throw new ApiError(404, "AI session not found");
  }

  return session;
};

const ensureAiDailyQuota = async (userId) => {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);

  const usedCount = await prisma.backgroundJob.count({
    where: {
      correlationId: userId,
      jobType: {
        in: ["AI_CHAT", "AI_SUMMARY"],
      },
      createdAt: {
        gte: dayStart,
      },
    },
  });

  if (usedCount >= DAILY_AI_MESSAGES_LIMIT) {
    throw new ApiError(429, "AI daily limit reached. Try again tomorrow.");
  }

  return {
    used: usedCount,
    limit: DAILY_AI_MESSAGES_LIMIT,
  };
};

const recordAiUsage = async ({ userId, jobType, payload }) => {
  await prisma.backgroundJob.create({
    data: {
      jobType,
      status: "COMPLETED",
      correlationId: userId,
      payload: payload || undefined,
      result: {
        trackedAt: new Date().toISOString(),
      },
      completedAt: new Date(),
    },
  });
};

const buildAiReplyPrompt = ({
  videoContextText,
  latestUserMessage,
  history,
  contextMeta,
}) => {
  const historyBlock = history
    .map((row) => `${row.role === "USER" ? "User" : "Assistant"}: ${trimTo(row.content, 1200)}`)
    .join("\n");

  return [
    "Context about the video:",
    videoContextText,
    "",
    "Context health:",
    `- transcriptAvailable: ${contextMeta?.hasTranscript ? "yes" : "no"}`,
    `- contextQuality: ${contextMeta?.quality || "MINIMAL"}`,
    "",
    "Conversation history:",
    historyBlock || "No previous messages.",
    "",
    `Latest user question: ${latestUserMessage}`,
    "",
    "Answer clearly and naturally.",
    "If user sends greeting/small-talk, respond briefly and friendly.",
    'Never use boilerplate phrasing like "As an AI, I don\'t watch videos like a human".',
    "If user asks about context source, explain briefly that answers come from transcript/metadata available in this session.",
    "For video questions, use provided context; when missing, give best-effort answer and clearly mark uncertainty.",
  ].join("\n");
};

const toClientMessage = (message) => ({
  ...message,
  text: message?.content || "",
  message: message?.content || "",
  roleLower: String(message?.role || "").toLowerCase(),
});

export const createAiSession = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const videoId = normalizeText(req.body?.videoId);
  const rawTitle = normalizeText(req.body?.title);

  let resolvedVideoId = null;
  let defaultTitle = buildDefaultSessionTitle();

  if (videoId) {
    const video = await loadVideoForAi({ videoId, viewerId: userId });
    resolvedVideoId = video.id;
    defaultTitle = buildDefaultSessionTitle(video.title);
  }

  const title = trimTo(rawTitle || defaultTitle, MAX_SESSION_TITLE_LENGTH);

  const session = await prisma.aIChatSession.create({
    data: {
      userId,
      videoId: resolvedVideoId || null,
      title,
      messages: {
        create: {
          role: "SYSTEM",
          content: resolvedVideoId
            ? "Session created for video Q&A."
            : "Session created for general assistant guidance.",
        },
      },
    },
    select: {
      id: true,
      userId: true,
      videoId: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      video: {
        select: {
          id: true,
          title: true,
          thumbnail: true,
        },
      },
    },
  });

  return res.status(201).json(
    new ApiResponse(
      201,
      {
        ...session,
        title: deriveSessionTitle(session),
        aiProvider: isAiConfigured() ? "gemini" : "fallback",
      },
      "AI session created"
    )
  );
});

export const listAiSessions = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { page, limit, skip } = sanitizePagination(req.query?.page, req.query?.limit, 50);

  const [totalItems, sessions] = await Promise.all([
    prisma.aIChatSession.count({
      where: { userId },
    }),
    prisma.aIChatSession.findMany({
      where: { userId },
      skip,
      take: limit,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        userId: true,
        videoId: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { messages: true },
        },
        video: {
          select: {
            id: true,
            title: true,
            thumbnail: true,
          },
        },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            role: true,
            content: true,
            createdAt: true,
          },
        },
      },
    }),
  ]);

  const items = sessions.map((session) => ({
    id: session.id,
    userId: session.userId,
    videoId: session.videoId,
    title: deriveSessionTitle(session),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session._count?.messages || 0,
    lastMessage: session.messages?.[0]
      ? toClientMessage(session.messages[0])
      : null,
    video: session.video || null,
  }));

  return res.status(200).json(
    new ApiResponse(
      200,
      buildPaginatedListData({
        key: "sessions",
        items,
        currentPage: page,
        limit,
        totalItems,
      }),
      "AI sessions fetched"
    )
  );
});

export const getAiSessionMessages = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const sessionId = normalizeText(req.params?.sessionId);
  if (!sessionId) throw new ApiError(400, "sessionId is required");

  await ensureSessionOwnership({ sessionId, userId });
  const { page, limit, skip } = sanitizePagination(req.query?.page, req.query?.limit, 100);

  const [session, totalItems, messages] = await Promise.all([
    prisma.aIChatSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        title: true,
        video: {
          select: {
            id: true,
            title: true,
            thumbnail: true,
          },
        },
      },
    }),
    prisma.aIChatMessage.count({
      where: { sessionId },
    }),
    prisma.aIChatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: "asc" },
      skip,
      take: limit,
      select: {
        id: true,
        role: true,
        content: true,
        tokensUsed: true,
        createdAt: true,
      },
    }),
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      buildPaginatedListData({
        key: "messages",
        items: messages.map(toClientMessage),
        currentPage: page,
        limit,
        totalItems,
        extra: {
          session: session
            ? {
                id: session.id,
                title: deriveSessionTitle(session),
                video: session.video || null,
              }
            : null,
        },
      }),
      "AI messages fetched"
    )
  );
});

export const sendAiSessionMessage = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const sessionId = normalizeText(req.params?.sessionId);
  const message = trimTo(req.body?.message, MAX_USER_MESSAGE_LENGTH);

  if (!sessionId) throw new ApiError(400, "sessionId is required");
  if (!message) throw new ApiError(400, "message is required");

  const session = await ensureSessionOwnership({ sessionId, userId });

  const [video, recentMessages] = await Promise.all([
    session.videoId
      ? loadVideoForAi({ videoId: session.videoId, viewerId: userId })
      : Promise.resolve(null),
    prisma.aIChatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: "desc" },
      take: Math.max(MAX_CONTEXT_MESSAGES, MAX_SESSION_CACHE_LOOKBACK_MESSAGES),
      select: {
        id: true,
        role: true,
        content: true,
        createdAt: true,
      },
    }),
  ]);

  const orderedRecentMessages = [...recentMessages].reverse();
  const orderedHistory = orderedRecentMessages
    .slice(-MAX_CONTEXT_MESSAGES)
    .map((row) => ({
      role: row.role,
      content: row.content,
    }));
  const contextMeta = buildChatContextMeta({
    video,
    transcriptText: video?.transcriptText || "",
  });
  const cachedReply = findSessionCachedReply({
    orderedRecentMessages,
    incomingMessage: message,
  });

  if (cachedReply) {
    const created = await prisma.$transaction(async (tx) => {
      const userMessage = await tx.aIChatMessage.create({
        data: {
          sessionId,
          role: "USER",
          content: message,
        },
        select: {
          id: true,
          role: true,
          content: true,
          createdAt: true,
        },
      });

      const assistantMessage = await tx.aIChatMessage.create({
        data: {
          sessionId,
          role: "ASSISTANT",
          content: cachedReply,
        },
        select: {
          id: true,
          role: true,
          content: true,
          createdAt: true,
        },
      });

      await tx.aIChatSession.update({
        where: { id: sessionId },
        data: { updatedAt: new Date() },
      });

      return { userMessage, assistantMessage };
    });

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          sessionId,
          userMessage: toClientMessage(created.userMessage),
          assistantMessage: toClientMessage(created.assistantMessage),
          reply: created.assistantMessage?.content || "",
          answer: created.assistantMessage?.content || "",
          context: contextMeta,
          ai: {
            provider: "session-cache",
            model: "none",
            warning: null,
            quota: null,
          },
        },
        "AI response generated (cached)"
      )
    );
  }

  if (isGreetingOrSmallTalk(message)) {
    const replyText = buildSmallTalkReply({ video, contextMeta });

    const created = await prisma.$transaction(async (tx) => {
      const userMessage = await tx.aIChatMessage.create({
        data: {
          sessionId,
          role: "USER",
          content: message,
        },
        select: {
          id: true,
          role: true,
          content: true,
          createdAt: true,
        },
      });

      const assistantMessage = await tx.aIChatMessage.create({
        data: {
          sessionId,
          role: "ASSISTANT",
          content: replyText,
        },
        select: {
          id: true,
          role: true,
          content: true,
          createdAt: true,
        },
      });

      await tx.aIChatSession.update({
        where: { id: sessionId },
        data: { updatedAt: new Date() },
      });

      return { userMessage, assistantMessage };
    });

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          sessionId,
          userMessage: toClientMessage(created.userMessage),
          assistantMessage: toClientMessage(created.assistantMessage),
          reply: created.assistantMessage?.content || "",
          answer: created.assistantMessage?.content || "",
          context: contextMeta,
          ai: {
            provider: "rule-based",
            model: "none",
            warning: null,
            quota: null,
          },
        },
        "AI response generated"
      )
    );
  }

  if (video && isContextSourceQuestion(message)) {
    const replyText = buildContextSourceReply({ video, contextMeta });

    const created = await prisma.$transaction(async (tx) => {
      const userMessage = await tx.aIChatMessage.create({
        data: {
          sessionId,
          role: "USER",
          content: message,
        },
        select: {
          id: true,
          role: true,
          content: true,
          createdAt: true,
        },
      });

      const assistantMessage = await tx.aIChatMessage.create({
        data: {
          sessionId,
          role: "ASSISTANT",
          content: replyText,
        },
        select: {
          id: true,
          role: true,
          content: true,
          createdAt: true,
        },
      });

      await tx.aIChatSession.update({
        where: { id: sessionId },
        data: { updatedAt: new Date() },
      });

      return { userMessage, assistantMessage };
    });

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          sessionId,
          userMessage: toClientMessage(created.userMessage),
          assistantMessage: toClientMessage(created.assistantMessage),
          reply: created.assistantMessage?.content || "",
          answer: created.assistantMessage?.content || "",
          context: contextMeta,
          ai: {
            provider: "rule-based",
            model: "none",
            warning: null,
            quota: null,
          },
        },
        "AI response generated"
      )
    );
  }

  const quota = await ensureAiDailyQuota(userId);

  const transcriptContext = video
    ? pickTranscriptContextForQuestion({
        transcriptText: video.transcriptText,
        transcriptSegments: video.transcriptSegments,
        question: message,
      })
    : "";

  const videoContextText = video
    ? buildVideoContextText({
        video,
        transcriptText: transcriptContext,
      })
    : "No specific video context. Assist user with platform guidance and concise answers.";

  const systemInstruction = video
    ? "You are Vixora video assistant. Be natural and concise. For greetings, reply friendly. For video questions, use available context. If transcript/context is weak, give a best-effort answer and clearly mark uncertainty instead of refusing abruptly. Do not use generic boilerplate like 'As an AI, I do not watch videos like a human'."
    : "You are Vixora platform assistant. Help with uploads, playback, account, and creator workflows.";

  const userPrompt = buildAiReplyPrompt({
    videoContextText,
    latestUserMessage: message,
    history: orderedHistory,
    contextMeta,
  });

  const fallbackText = video
    ? buildAnswerFallback({
        question: message,
        title: video.title,
        summary: video.summary || video.description,
      })
    : `I can help with Vixora usage. Your question was: "${message}".`;

  const aiReply = await generateAiText({
    systemInstruction,
    userPrompt,
    temperature: 0.35,
    maxOutputTokens: 500,
    fallbackText,
  });

  const created = await prisma.$transaction(async (tx) => {
    const userMessage = await tx.aIChatMessage.create({
      data: {
        sessionId,
        role: "USER",
        content: message,
      },
      select: {
        id: true,
        role: true,
        content: true,
        createdAt: true,
      },
    });

    const assistantMessage = await tx.aIChatMessage.create({
      data: {
        sessionId,
        role: "ASSISTANT",
        content: aiReply.text,
      },
      select: {
        id: true,
        role: true,
        content: true,
        createdAt: true,
      },
    });

    await tx.aIChatSession.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() },
    });

    return { userMessage, assistantMessage };
  });

  await recordAiUsage({
    userId,
    jobType: "AI_CHAT",
    payload: {
      sessionId,
      videoId: session.videoId || null,
      provider: aiReply.provider,
      model: aiReply.model,
    },
  }).catch(() => null);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        sessionId,
        userMessage: toClientMessage(created.userMessage),
        assistantMessage: toClientMessage(created.assistantMessage),
        reply: created.assistantMessage?.content || "",
        answer: created.assistantMessage?.content || "",
        context: contextMeta,
        ai: {
          provider: aiReply.provider,
          model: aiReply.model,
          warning: aiReply.warning || null,
          quota: {
            usedToday: quota.used + 1,
            dailyLimit: quota.limit,
            remaining: Math.max(0, quota.limit - (quota.used + 1)),
          },
        },
      },
      "AI response generated"
    )
  );
});

export const getVideoSummary = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const videoId = normalizeText(req.params?.videoId);
  if (!videoId) throw new ApiError(400, "videoId is required");

  const video = await loadVideoForAi({ videoId, viewerId: userId });
  const contextMeta = buildChatContextMeta({
    video,
    transcriptText: video.transcriptText,
  });

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        videoId: video.id,
        summary: video.summary || null,
        hasSummary: Boolean(video.summary),
        context: contextMeta,
        transcript: video.transcriptMeta,
      },
      video.summary ? "Video summary fetched" : "Summary not generated yet"
    )
  );
});

export const upsertVideoTranscript = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const videoId = normalizeText(req.params?.videoId);
  const transcriptInput = req.body?.transcript;
  const cuesInput = req.body?.cues ?? req.body?.segments ?? req.body?.transcriptCues ?? null;
  const language = trimTo(req.body?.language, 16) || null;
  const source = normalizeTranscriptSource(req.body?.source);

  if (!videoId) throw new ApiError(400, "videoId is required");

  if (
    normalizeText(transcriptInput).length > MAX_TRANSCRIPT_INPUT_CHARS &&
    (!Array.isArray(cuesInput) || cuesInput.length === 0)
  ) {
    throw new ApiError(
      400,
      `transcript is too long (max ${MAX_TRANSCRIPT_INPUT_CHARS} chars)`
    );
  }

  const video = await prisma.video.findUnique({
    where: { id: videoId },
    select: {
      id: true,
      ownerId: true,
      title: true,
      duration: true,
      isDeleted: true,
    },
  });

  if (!video || video.isDeleted) {
    throw new ApiError(404, "Video not found");
  }

  if (video.ownerId !== userId) {
    throw new ApiError(403, "Only the video owner can update transcript");
  }

  const parsedTranscript = parseTranscriptInput({
    transcript: transcriptInput,
    cues: cuesInput,
    durationSeconds: video.duration || null,
  });

  if (!parsedTranscript.transcriptText) {
    throw new ApiError(400, "Provide transcript text or cues/segments");
  }

  if (parsedTranscript.transcriptText.length > MAX_TRANSCRIPT_INPUT_CHARS) {
    throw new ApiError(
      400,
      `transcript is too long (max ${MAX_TRANSCRIPT_INPUT_CHARS} chars)`
    );
  }

  const saved = await prisma.videoTranscript.upsert({
    where: { videoId: video.id },
    update: {
      transcript: parsedTranscript.transcriptText,
      segments: parsedTranscript.segments,
      language,
      source,
      wordCount: parsedTranscript.wordCount,
      generatedAt: new Date(),
    },
    create: {
      videoId: video.id,
      transcript: parsedTranscript.transcriptText,
      segments: parsedTranscript.segments,
      language,
      source,
      wordCount: parsedTranscript.wordCount,
      generatedAt: new Date(),
    },
    select: {
      id: true,
      videoId: true,
      language: true,
      source: true,
      wordCount: true,
      segments: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        ...saved,
        transcriptChars: parsedTranscript.transcriptText.length,
        segmentCount: parsedTranscript.segmentCount,
      },
      "Video transcript saved"
    )
  );
});

export const getVideoTranscriptForAi = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const videoId = normalizeText(req.params?.videoId);

  if (!videoId) throw new ApiError(400, "videoId is required");

  const q = normalizeText(req.query?.q || "");
  const fromMs =
    parseTimeQueryToMs(req.query?.from) ??
    (parseNonNegativeNumber(req.query?.fromSeconds) !== null
      ? Math.floor(Number(req.query.fromSeconds) * 1000)
      : null);
  const toMs =
    parseTimeQueryToMs(req.query?.to) ??
    (parseNonNegativeNumber(req.query?.toSeconds) !== null
      ? Math.floor(Number(req.query.toSeconds) * 1000)
      : null);

  const { page, limit } = sanitizePagination(req.query?.page, req.query?.limit, 200);
  const skip = (page - 1) * limit;

  const video = await loadVideoForAi({ videoId, viewerId: userId });
  const transcriptData = resolveTranscriptForRead({
    transcript: video?.transcript?.transcript || video.transcriptText,
    segments: video?.transcript?.segments || video.transcriptSegments,
    durationSeconds: video?.duration || null,
  });

  const filtered = filterTranscriptSegments({
    segments: transcriptData.segments,
    query: q,
    fromMs,
    toMs,
  });

  const items = filtered.slice(skip, skip + limit);

  return res.status(200).json(
    new ApiResponse(
      200,
      buildPaginatedListData({
        key: "segments",
        items,
        currentPage: page,
        limit,
        totalItems: filtered.length,
        extra: {
          videoId: video.id,
          title: video.title,
          transcript: transcriptData.transcriptText,
          hasTranscript: Boolean(transcriptData.transcriptText),
          language: video.transcriptMeta?.language || null,
          source: video.transcriptMeta?.source || null,
          wordCount: video.transcriptMeta?.wordCount || transcriptData.wordCount || 0,
          segmentCount: transcriptData.segmentCount || 0,
          filters: {
            q: q || null,
            fromMs,
            toMs,
          },
        },
      }),
      "Video transcript fetched"
    )
  );
});

export const deleteVideoTranscript = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const videoId = normalizeText(req.params?.videoId);

  if (!videoId) throw new ApiError(400, "videoId is required");

  const video = await prisma.video.findUnique({
    where: { id: videoId },
    select: { id: true, ownerId: true, isDeleted: true },
  });

  if (!video || video.isDeleted) {
    throw new ApiError(404, "Video not found");
  }

  if (video.ownerId !== userId) {
    throw new ApiError(403, "Only the video owner can delete transcript");
  }

  await prisma.videoTranscript.deleteMany({
    where: { videoId: video.id },
  });

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        videoId: video.id,
        deleted: true,
      },
      "Video transcript deleted"
    )
  );
});

export const generateVideoSummary = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const videoId = normalizeText(req.params?.videoId);
  const force = parseBoolean(req.body?.force, false);
  if (!videoId) throw new ApiError(400, "videoId is required");

  const video = await loadVideoForAi({ videoId, viewerId: userId });
  const contextMeta = buildChatContextMeta({
    video,
    transcriptText: video.transcriptText,
  });

  if (!force && video.summary) {
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          videoId: video.id,
          summary: video.summary,
          source: "existing",
          context: contextMeta,
        },
        "Video summary fetched"
      )
    );
  }

  const quota = await ensureAiDailyQuota(userId);

  const transcriptContext = pickTranscriptContextForQuestion({
    transcriptText: video.transcriptText,
    transcriptSegments: video.transcriptSegments,
    question: "summarize key points from the full video",
  });

  const videoContextText = buildVideoContextText({
    video,
    transcriptText: transcriptContext,
    includeSummary: false,
  });

  const prompt = [
    "Create a concise YouTube-style summary for this video.",
    "Use 5 to 8 bullet points.",
    "Include key takeaways and practical context.",
    "Use available context first; if transcript is missing, still provide a useful best-effort summary from title/description and label uncertainty briefly.",
    "",
    videoContextText,
  ].join("\n");

  const fallbackSummary = buildSummaryFallback({
    title: video.title,
    description: video.description,
  });

  const aiResult = await generateAiText({
    systemInstruction:
      "You are a precise video summarizer. Output compact bullet points with factual language.",
    userPrompt: prompt,
    temperature: 0.2,
    maxOutputTokens: 450,
    fallbackText: fallbackSummary,
  });

  const updated = await prisma.video.update({
    where: { id: video.id },
    data: {
      summary: aiResult.text,
    },
    select: {
      id: true,
      summary: true,
      updatedAt: true,
    },
  });

  await recordAiUsage({
    userId,
    jobType: "AI_SUMMARY",
    payload: {
      videoId: updated.id,
      provider: aiResult.provider,
      model: aiResult.model,
    },
  }).catch(() => null);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        videoId: updated.id,
        summary: updated.summary,
        source: aiResult.provider,
        model: aiResult.model,
        warning: aiResult.warning || null,
        context: contextMeta,
        quota: {
          usedToday: quota.used + 1,
          dailyLimit: quota.limit,
          remaining: Math.max(0, quota.limit - (quota.used + 1)),
        },
        updatedAt: updated.updatedAt,
      },
      "Video summary generated"
    )
  );
});

export const askVideoQuestion = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const videoId = normalizeText(req.params?.videoId);
  const question = trimTo(req.body?.question, MAX_USER_MESSAGE_LENGTH);

  if (!videoId) throw new ApiError(400, "videoId is required");
  if (!question) throw new ApiError(400, "question is required");

  const video = await loadVideoForAi({ videoId, viewerId: userId });
  const contextMeta = buildChatContextMeta({
    video,
    transcriptText: video.transcriptText,
  });

  if (isGreetingOrSmallTalk(question)) {
    const answerText = buildSmallTalkReply({ video, contextMeta });
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          videoId: video.id,
          question,
          answer: answerText,
          reply: answerText,
          context: contextMeta,
          ai: {
            provider: "rule-based",
            model: "none",
            warning: null,
            quota: null,
          },
        },
        "AI answer generated"
      )
    );
  }

  if (isContextSourceQuestion(question)) {
    const answerText = buildContextSourceReply({ video, contextMeta });
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          videoId: video.id,
          question,
          answer: answerText,
          reply: answerText,
          context: contextMeta,
          ai: {
            provider: "rule-based",
            model: "none",
            warning: null,
            quota: null,
          },
        },
        "AI answer generated"
      )
    );
  }

  const quota = await ensureAiDailyQuota(userId);

  const transcriptContext = pickTranscriptContextForQuestion({
    transcriptText: video.transcriptText,
    transcriptSegments: video.transcriptSegments,
    question,
  });

  const videoContextText = buildVideoContextText({
    video,
    transcriptText: transcriptContext,
  });

  const prompt = [
    "Answer the user question using provided video context.",
    "If transcript is missing, provide best-effort explanation from title/description/summary and clearly label uncertainty.",
    "Do not return an empty refusal when helpful partial guidance is possible.",
    "",
    videoContextText,
    "",
    `Question: ${question}`,
  ].join("\n");

  const fallbackAnswer = buildAnswerFallback({
    question,
    title: video.title,
    summary: video.summary || video.description,
  });

  const aiResult = await generateAiText({
    systemInstruction:
      "You are a helpful video Q&A assistant. Keep answers clear, practical, and beginner-friendly. Stay grounded in provided context and mark uncertainty briefly when context is weak. Do not use phrases like 'As an AI I cannot watch videos'; instead say answers are based on available transcript/metadata.",
    userPrompt: prompt,
    temperature: 0.3,
    maxOutputTokens: 400,
    fallbackText: fallbackAnswer,
  });

  await recordAiUsage({
    userId,
    jobType: "AI_CHAT",
    payload: {
      videoId: video.id,
      provider: aiResult.provider,
      model: aiResult.model,
      mode: "ask",
    },
  }).catch(() => null);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        videoId: video.id,
        question,
        answer: aiResult.text,
        reply: aiResult.text,
        context: contextMeta,
        ai: {
          provider: aiResult.provider,
          model: aiResult.model,
          warning: aiResult.warning || null,
          quota: {
            usedToday: quota.used + 1,
            dailyLimit: quota.limit,
            remaining: Math.max(0, quota.limit - (quota.used + 1)),
          },
        },
      },
      "AI answer generated"
    )
  );
});

export const renameAiSession = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const sessionId = normalizeText(req.params?.sessionId);
  const title = trimTo(req.body?.title, MAX_SESSION_TITLE_LENGTH);

  if (!sessionId) throw new ApiError(400, "sessionId is required");
  if (!title) throw new ApiError(400, "title is required");

  await ensureSessionOwnership({ sessionId, userId });

  const updated = await prisma.aIChatSession.update({
    where: { id: sessionId },
    data: {
      title,
      updatedAt: new Date(),
    },
    select: {
      id: true,
      userId: true,
      videoId: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      video: {
        select: {
          id: true,
          title: true,
          thumbnail: true,
        },
      },
    },
  });

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        ...updated,
        title: deriveSessionTitle(updated),
      },
      "AI session renamed"
    )
  );
});

export const deleteAiSession = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const sessionId = normalizeText(req.params?.sessionId);

  if (!sessionId) throw new ApiError(400, "sessionId is required");

  await ensureSessionOwnership({ sessionId, userId });

  await prisma.aIChatSession.delete({
    where: { id: sessionId },
  });

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        sessionId,
        deleted: true,
      },
      "AI session deleted"
    )
  );
});

export const clearAllAiSessions = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const videoId = normalizeText(req.query?.videoId);

  const deleteResult = await prisma.aIChatSession.deleteMany({
    where: {
      userId,
      ...(videoId ? { videoId } : {}),
    },
  });

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        deletedSessions: deleteResult.count,
        filter: {
          videoId: videoId || null,
        },
      },
      "AI sessions cleared"
    )
  );
});

export const clearAiSessionMessages = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const sessionId = normalizeText(req.params?.sessionId);
  const keepSystem = parseBoolean(req.query?.keepSystem, true);

  if (!sessionId) throw new ApiError(400, "sessionId is required");

  await ensureSessionOwnership({ sessionId, userId });

  const where = {
    sessionId,
    ...(keepSystem ? { role: { not: "SYSTEM" } } : {}),
  };

  const deleteResult = await prisma.aIChatMessage.deleteMany({
    where,
  });

  await prisma.aIChatSession.update({
    where: { id: sessionId },
    data: { updatedAt: new Date() },
  });

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        sessionId,
        deletedMessages: deleteResult.count,
        keepSystem,
      },
      "AI session messages cleared"
    )
  );
});

export const deleteAiSessionMessage = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const sessionId = normalizeText(req.params?.sessionId);
  const messageId = normalizeText(req.params?.messageId);
  const cascade = parseBoolean(req.query?.cascade, true);

  if (!sessionId) throw new ApiError(400, "sessionId is required");
  if (!messageId) throw new ApiError(400, "messageId is required");

  await ensureSessionOwnership({ sessionId, userId });

  const target = await prisma.aIChatMessage.findFirst({
    where: {
      id: messageId,
      sessionId,
    },
    select: {
      id: true,
      role: true,
      createdAt: true,
    },
  });

  if (!target) throw new ApiError(404, "Message not found");
  if (target.role === "SYSTEM") {
    throw new ApiError(400, "System message cannot be deleted");
  }

  const deletedIds = [target.id];

  if (cascade && target.role === "USER") {
    const nextMessage = await prisma.aIChatMessage.findFirst({
      where: {
        sessionId,
        createdAt: {
          gt: target.createdAt,
        },
      },
      orderBy: {
        createdAt: "asc",
      },
      select: {
        id: true,
        role: true,
      },
    });

    if (nextMessage?.role === "ASSISTANT") {
      deletedIds.push(nextMessage.id);
    }
  }

  await prisma.$transaction([
    prisma.aIChatMessage.deleteMany({
      where: {
        id: { in: deletedIds },
        sessionId,
      },
    }),
    prisma.aIChatSession.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() },
    }),
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        sessionId,
        deletedIds,
        deletedCount: deletedIds.length,
        cascadeApplied: deletedIds.length > 1,
      },
      "AI message deleted"
    )
  );
});
