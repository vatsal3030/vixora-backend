import prisma from "../../db/prisma.js";
import ApiError from "../../utils/ApiError.js";
import ApiResponse from "../../utils/ApiResponse.js";
import asyncHandler from "../../utils/asyncHandler.js";
import { writeAdminAuditLog } from "../../services/admin.audit.service.js";

const MAX_TOPICS = 25;
const MAX_TOPIC_LENGTH = 30;
const MAX_CATEGORY_SLUG_LENGTH = 60;
const FALLBACK_FEED_TOPICS = Object.freeze([
  "music",
  "gaming",
  "tech",
  "live",
  "news",
  "movies",
]);

const normalizeTopic = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .slice(0, MAX_TOPIC_LENGTH);

const toDisplayName = (value) =>
  String(value || "")
    .split(/[\s_-]+/)
    .map((chunk) =>
      chunk ? chunk.charAt(0).toUpperCase() + chunk.slice(1) : chunk
    )
    .join(" ")
    .trim();

const toCategorySlug = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, MAX_CATEGORY_SLUG_LENGTH);

const parseTopics = (rawValue) => {
  if (rawValue === undefined || rawValue === null || rawValue === "") return [];

  const rawEntries = Array.isArray(rawValue)
    ? rawValue
    : String(rawValue).split(",");

  const output = [];
  const seen = new Set();

  for (const entry of rawEntries) {
    const topic = normalizeTopic(entry);
    if (!topic || seen.has(topic)) continue;
    seen.add(topic);
    output.push(topic);
    if (output.length >= MAX_TOPICS) break;
  }

  return output;
};

const resolveSeedTopics = (body) => {
  const explicitTopics = parseTopics(
    body?.topics ?? body?.tags ?? body?.categories ?? body?.names
  );

  if (explicitTopics.length > 0) return explicitTopics;

  const envTopics = parseTopics(process.env.DEFAULT_FEED_TOPICS);
  if (envTopics.length > 0) return envTopics;

  return [...FALLBACK_FEED_TOPICS];
};

export const seedAdminFeedTopics = asyncHandler(async (req, res) => {
  const topics = resolveSeedTopics(req.body);

  if (topics.length === 0) {
    throw new ApiError(400, "No valid topics provided");
  }

  await prisma.tag.createMany({
    data: topics.map((name) => ({ name })),
    skipDuplicates: true,
  });

  const tagRows = await prisma.tag.findMany({
    where: {
      name: {
        in: topics,
      },
    },
    select: {
      id: true,
      name: true,
    },
    orderBy: {
      name: "asc",
    },
  });

  const categorySeedRows = [];
  const seenSlugs = new Set();
  for (const topic of topics) {
    const slug = toCategorySlug(topic);
    if (!slug || seenSlugs.has(slug)) continue;
    seenSlugs.add(slug);
    categorySeedRows.push({
      slug,
      name: toDisplayName(topic),
      isActive: true,
    });
  }

  if (categorySeedRows.length > 0) {
    await prisma.category.createMany({
      data: categorySeedRows,
      skipDuplicates: true,
    });
  }

  const categoryRows = categorySeedRows.length > 0
    ? await prisma.category.findMany({
        where: {
          slug: {
            in: categorySeedRows.map((row) => row.slug),
          },
        },
        select: {
          id: true,
          name: true,
          slug: true,
          isActive: true,
        },
        orderBy: {
          name: "asc",
        },
      })
    : [];

  await writeAdminAuditLog({
    req,
    actor: req.user,
    action: "ADMIN_FEED_TOPICS_SEED",
    targetType: "SYSTEM",
    targetId: "feed-topics",
    metadata: {
      topics,
      tagCount: tagRows.length,
      categoryCount: categoryRows.length,
    },
  });

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        topics,
        tags: tagRows,
        categories: categoryRows,
        summary: {
          requestedTopics: topics.length,
          resolvedTags: tagRows.length,
          resolvedCategories: categoryRows.length,
        },
      },
      "Feed topics seeded"
    )
  );
});

