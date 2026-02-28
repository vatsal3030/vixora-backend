import prisma from "../../db/prisma.js";
import ApiError from "../../utils/ApiError.js";
import ApiResponse from "../../utils/ApiResponse.js";
import asyncHandler from "../../utils/asyncHandler.js";
import { sanitizePagination } from "../../utils/pagination.js";
import { sanitizeSort } from "../../utils/sanitizeSort.js";
import { buildPaginatedListData } from "../../utils/listResponse.js";
import {
  MAX_ADMIN_LIST_LIMIT,
  ensureRequiredId,
  normalizeOptionalText,
  normalizeText,
  parseBoolQuery,
  toUserSummary,
} from "../../services/admin.controller.utils.js";
import {
  runAdminCommentRestore,
  runAdminCommentSoftDelete,
  runAdminPlaylistRestore,
  runAdminPlaylistSoftDelete,
  runAdminTweetRestore,
  runAdminTweetSoftDelete,
  runAdminVideoPublish,
  runAdminVideoRestore,
  runAdminVideoSoftDelete,
  runAdminVideoUnpublish,
} from "../../services/admin.contentModeration.service.js";

const mapVideoItem = (row) => ({
  ...row,
  owner: toUserSummary(row.owner),
  stats: {
    comments: row._count.comments,
    likes: row._count.likes,
  },
  _count: undefined,
});

export const getAdminVideos = asyncHandler(async (req, res) => {
  const { page, limit, skip } = sanitizePagination(req.query.page, req.query.limit, MAX_ADMIN_LIST_LIMIT);

  const { sortBy, sortType } = sanitizeSort(
    normalizeText(req.query.sortBy || "createdAt"),
    normalizeText(req.query.sortType || "desc"),
    ["createdAt", "updatedAt", "views", "title", "duration", "processingStatus"],
    "createdAt"
  );

  const q = normalizeText(req.query.q).slice(0, 120);
  const ownerId = normalizeText(req.query.ownerId);
  const isShort = parseBoolQuery(req.query.isShort);
  const isPublished = parseBoolQuery(req.query.isPublished);
  const isDeleted = parseBoolQuery(req.query.isDeleted);
  const processingStatus = normalizeText(req.query.processingStatus).toUpperCase();

  const where = {};

  if (ownerId) where.ownerId = ownerId;
  if (typeof isShort === "boolean") where.isShort = isShort;
  if (typeof isPublished === "boolean") where.isPublished = isPublished;
  if (typeof isDeleted === "boolean") where.isDeleted = isDeleted;

  if (processingStatus) {
    if (!["PENDING", "PROCESSING", "COMPLETED", "FAILED", "CANCELLED"].includes(processingStatus)) {
      throw new ApiError(400, "Invalid processingStatus filter");
    }
    where.processingStatus = processingStatus;
  }

  if (q) {
    where.OR = [
      { id: { contains: q, mode: "insensitive" } },
      { title: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
      { owner: { is: { username: { contains: q, mode: "insensitive" } } } },
      { owner: { is: { fullName: { contains: q, mode: "insensitive" } } } },
    ];
  }

  const [count, rows] = await Promise.all([
    prisma.video.count({ where }),
    prisma.video.findMany({
      where,
      orderBy: { [sortBy]: sortType },
      skip,
      take: limit,
      select: {
        id: true,
        title: true,
        description: true,
        thumbnail: true,
        duration: true,
        views: true,
        isShort: true,
        isPublished: true,
        isDeleted: true,
        deletedAt: true,
        processingStatus: true,
        processingProgress: true,
        isHlsReady: true,
        createdAt: true,
        updatedAt: true,
        owner: {
          select: {
            id: true,
            fullName: true,
            username: true,
            avatar: true,
            role: true,
            isDeleted: true,
          },
        },
        _count: {
          select: {
            comments: true,
            likes: true,
          },
        },
      },
    }),
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      buildPaginatedListData({
        key: "videos",
        items: rows.map(mapVideoItem),
        currentPage: page,
        limit,
        totalItems: count,
      }),
      "Admin videos fetched"
    )
  );
});

export const getAdminVideoById = asyncHandler(async (req, res) => {
  const videoId = ensureRequiredId(req.params.videoId, "videoId");

  const row = await prisma.video.findUnique({
    where: { id: videoId },
    select: {
      id: true,
      title: true,
      description: true,
      thumbnail: true,
      videoFile: true,
      playbackUrl: true,
      masterPlaylistUrl: true,
      availableQualities: true,
      duration: true,
      views: true,
      isShort: true,
      isPublished: true,
      isDeleted: true,
      deletedAt: true,
      processingStatus: true,
      processingProgress: true,
      isHlsReady: true,
      createdAt: true,
      updatedAt: true,
      owner: {
        select: {
          id: true,
          fullName: true,
          username: true,
          avatar: true,
          email: true,
          role: true,
          moderationStatus: true,
          isDeleted: true,
        },
      },
      tags: {
        select: {
          tag: {
            select: {
              name: true,
            },
          },
        },
      },
      transcript: {
        select: {
          id: true,
          language: true,
          source: true,
          wordCount: true,
          updatedAt: true,
        },
      },
      _count: {
        select: {
          comments: true,
          likes: true,
          watchHistory: true,
        },
      },
    },
  });

  if (!row) throw new ApiError(404, "Video not found");

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        ...row,
        owner: toUserSummary(row.owner),
        tags: row.tags.map((entry) => entry.tag?.name).filter(Boolean),
        stats: {
          comments: row._count.comments,
          likes: row._count.likes,
          watchers: row._count.watchHistory,
        },
        _count: undefined,
      },
      "Admin video detail fetched"
    )
  );
});

export const unpublishAdminVideo = asyncHandler(async (req, res) => {
  const videoId = ensureRequiredId(req.params.videoId, "videoId");
  const updated = await runAdminVideoUnpublish({
    req,
    actor: req.user,
    videoId,
    reason: normalizeOptionalText(req.body?.reason, 500),
  });

  return res.status(200).json(new ApiResponse(200, updated, "Video unpublished"));
});

export const publishAdminVideo = asyncHandler(async (req, res) => {
  const videoId = ensureRequiredId(req.params.videoId, "videoId");
  const updated = await runAdminVideoPublish({
    req,
    actor: req.user,
    videoId,
    reason: normalizeOptionalText(req.body?.reason, 500),
  });

  return res.status(200).json(new ApiResponse(200, updated, "Video published"));
});

export const softDeleteAdminVideo = asyncHandler(async (req, res) => {
  const videoId = ensureRequiredId(req.params.videoId, "videoId");
  const updated = await runAdminVideoSoftDelete({
    req,
    actor: req.user,
    videoId,
    reason: normalizeOptionalText(req.body?.reason, 500),
  });

  return res.status(200).json(new ApiResponse(200, updated, "Video soft deleted"));
});

export const restoreAdminVideo = asyncHandler(async (req, res) => {
  const videoId = ensureRequiredId(req.params.videoId, "videoId");
  const updated = await runAdminVideoRestore({
    req,
    actor: req.user,
    videoId,
    reason: normalizeOptionalText(req.body?.reason, 500),
  });

  return res.status(200).json(new ApiResponse(200, updated, "Video restored"));
});

const buildSimpleListResponse = ({ key, items, page, limit, totalItems, message }) =>
  new ApiResponse(
    200,
    buildPaginatedListData({
      key,
      items,
      currentPage: page,
      limit,
      totalItems,
    }),
    message
  );

const buildListWhereWithOwnerAndQuery = ({ q, ownerId, isDeleted, contentField = "content" }) => {
  const where = {};

  if (ownerId) where.ownerId = ownerId;
  if (typeof isDeleted === "boolean") where.isDeleted = isDeleted;

  if (q) {
    where.OR = [
      { id: { contains: q, mode: "insensitive" } },
      { [contentField]: { contains: q, mode: "insensitive" } },
      { owner: { is: { username: { contains: q, mode: "insensitive" } } } },
      { owner: { is: { fullName: { contains: q, mode: "insensitive" } } } },
    ];
  }

  return where;
};

export const getAdminTweets = asyncHandler(async (req, res) => {
  const { page, limit, skip } = sanitizePagination(req.query.page, req.query.limit, MAX_ADMIN_LIST_LIMIT);
  const { sortBy, sortType } = sanitizeSort(
    normalizeText(req.query.sortBy || "createdAt"),
    normalizeText(req.query.sortType || "desc"),
    ["createdAt", "updatedAt"],
    "createdAt"
  );

  const q = normalizeText(req.query.q).slice(0, 120);
  const ownerId = normalizeText(req.query.ownerId);
  const isDeleted = parseBoolQuery(req.query.isDeleted);
  const where = buildListWhereWithOwnerAndQuery({ q, ownerId, isDeleted, contentField: "content" });

  const [count, rows] = await Promise.all([
    prisma.tweet.count({ where }),
    prisma.tweet.findMany({
      where,
      orderBy: { [sortBy]: sortType },
      skip,
      take: limit,
      select: {
        id: true,
        content: true,
        image: true,
        imageId: true,
        isDeleted: true,
        deletedAt: true,
        createdAt: true,
        updatedAt: true,
        owner: {
          select: {
            id: true,
            fullName: true,
            username: true,
            avatar: true,
            role: true,
            isDeleted: true,
          },
        },
        _count: {
          select: {
            likes: true,
            comments: true,
          },
        },
      },
    }),
  ]);

  const items = rows.map((row) => ({
    ...row,
    owner: toUserSummary(row.owner),
    stats: {
      likes: row._count.likes,
      comments: row._count.comments,
    },
    _count: undefined,
  }));

  return res.status(200).json(
    buildSimpleListResponse({ key: "tweets", items, page, limit, totalItems: count, message: "Admin tweets fetched" })
  );
});

export const getAdminTweetById = asyncHandler(async (req, res) => {
  const tweetId = ensureRequiredId(req.params.tweetId, "tweetId");

  const row = await prisma.tweet.findUnique({
    where: { id: tweetId },
    select: {
      id: true,
      content: true,
      image: true,
      imageId: true,
      isDeleted: true,
      deletedAt: true,
      createdAt: true,
      updatedAt: true,
      owner: {
        select: {
          id: true,
          fullName: true,
          username: true,
          avatar: true,
          email: true,
          role: true,
          moderationStatus: true,
          isDeleted: true,
        },
      },
      _count: {
        select: {
          likes: true,
          comments: true,
        },
      },
    },
  });

  if (!row) throw new ApiError(404, "Tweet not found");

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        ...row,
        owner: toUserSummary(row.owner),
        stats: {
          likes: row._count.likes,
          comments: row._count.comments,
        },
        _count: undefined,
      },
      "Admin tweet detail fetched"
    )
  );
});

export const softDeleteAdminTweet = asyncHandler(async (req, res) => {
  const tweetId = ensureRequiredId(req.params.tweetId, "tweetId");
  const updated = await runAdminTweetSoftDelete({
    req,
    actor: req.user,
    tweetId,
    reason: normalizeOptionalText(req.body?.reason, 500),
  });

  return res.status(200).json(new ApiResponse(200, updated, "Tweet soft deleted"));
});

export const restoreAdminTweet = asyncHandler(async (req, res) => {
  const tweetId = ensureRequiredId(req.params.tweetId, "tweetId");
  const updated = await runAdminTweetRestore({
    req,
    actor: req.user,
    tweetId,
    reason: normalizeOptionalText(req.body?.reason, 500),
  });

  return res.status(200).json(new ApiResponse(200, updated, "Tweet restored"));
});

export const getAdminComments = asyncHandler(async (req, res) => {
  const { page, limit, skip } = sanitizePagination(req.query.page, req.query.limit, MAX_ADMIN_LIST_LIMIT);
  const { sortBy, sortType } = sanitizeSort(
    normalizeText(req.query.sortBy || "createdAt"),
    normalizeText(req.query.sortType || "desc"),
    ["createdAt", "updatedAt"],
    "createdAt"
  );

  const q = normalizeText(req.query.q).slice(0, 120);
  const ownerId = normalizeText(req.query.ownerId);
  const videoId = normalizeText(req.query.videoId);
  const isDeleted = parseBoolQuery(req.query.isDeleted);

  const where = buildListWhereWithOwnerAndQuery({ q, ownerId, isDeleted, contentField: "content" });
  if (videoId) where.videoId = videoId;

  const [count, rows] = await Promise.all([
    prisma.comment.count({ where }),
    prisma.comment.findMany({
      where,
      orderBy: { [sortBy]: sortType },
      skip,
      take: limit,
      select: {
        id: true,
        content: true,
        isDeleted: true,
        deletedAt: true,
        createdAt: true,
        updatedAt: true,
        videoId: true,
        owner: {
          select: {
            id: true,
            fullName: true,
            username: true,
            avatar: true,
            role: true,
            isDeleted: true,
          },
        },
        video: {
          select: {
            id: true,
            title: true,
            isDeleted: true,
            isPublished: true,
          },
        },
      },
    }),
  ]);

  const items = rows.map((row) => ({
    ...row,
    owner: toUserSummary(row.owner),
    video: row.video
      ? {
          id: row.video.id,
          title: row.video.title,
          isDeleted: row.video.isDeleted,
          isPublished: row.video.isPublished,
        }
      : null,
  }));

  return res.status(200).json(
    buildSimpleListResponse({ key: "comments", items, page, limit, totalItems: count, message: "Admin comments fetched" })
  );
});

export const getAdminCommentById = asyncHandler(async (req, res) => {
  const commentId = ensureRequiredId(req.params.commentId, "commentId");

  const row = await prisma.comment.findUnique({
    where: { id: commentId },
    select: {
      id: true,
      content: true,
      isDeleted: true,
      deletedAt: true,
      createdAt: true,
      updatedAt: true,
      videoId: true,
      owner: {
        select: {
          id: true,
          fullName: true,
          username: true,
          avatar: true,
          email: true,
          role: true,
          moderationStatus: true,
          isDeleted: true,
        },
      },
      video: {
        select: {
          id: true,
          title: true,
          isDeleted: true,
          isPublished: true,
          owner: {
            select: {
              id: true,
              fullName: true,
              username: true,
              avatar: true,
              role: true,
            },
          },
        },
      },
    },
  });

  if (!row) throw new ApiError(404, "Comment not found");

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        ...row,
        owner: toUserSummary(row.owner),
        video: row.video
          ? {
              id: row.video.id,
              title: row.video.title,
              isDeleted: row.video.isDeleted,
              isPublished: row.video.isPublished,
              owner: toUserSummary(row.video.owner),
            }
          : null,
      },
      "Admin comment detail fetched"
    )
  );
});

export const softDeleteAdminComment = asyncHandler(async (req, res) => {
  const commentId = ensureRequiredId(req.params.commentId, "commentId");
  const updated = await runAdminCommentSoftDelete({
    req,
    actor: req.user,
    commentId,
    reason: normalizeOptionalText(req.body?.reason, 500),
  });

  return res.status(200).json(new ApiResponse(200, updated, "Comment soft deleted"));
});

export const restoreAdminComment = asyncHandler(async (req, res) => {
  const commentId = ensureRequiredId(req.params.commentId, "commentId");
  const updated = await runAdminCommentRestore({
    req,
    actor: req.user,
    commentId,
    reason: normalizeOptionalText(req.body?.reason, 500),
  });

  return res.status(200).json(new ApiResponse(200, updated, "Comment restored"));
});

export const getAdminPlaylists = asyncHandler(async (req, res) => {
  const { page, limit, skip } = sanitizePagination(req.query.page, req.query.limit, MAX_ADMIN_LIST_LIMIT);
  const { sortBy, sortType } = sanitizeSort(
    normalizeText(req.query.sortBy || "updatedAt"),
    normalizeText(req.query.sortType || "desc"),
    ["createdAt", "updatedAt", "name", "videoCount", "totalDuration"],
    "updatedAt"
  );

  const q = normalizeText(req.query.q).slice(0, 120);
  const ownerId = normalizeText(req.query.ownerId);
  const isDeleted = parseBoolQuery(req.query.isDeleted);
  const isPublic = parseBoolQuery(req.query.isPublic);

  const where = {};
  if (ownerId) where.ownerId = ownerId;
  if (typeof isDeleted === "boolean") where.isDeleted = isDeleted;
  if (typeof isPublic === "boolean") where.isPublic = isPublic;

  if (q) {
    where.OR = [
      { id: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
      { owner: { is: { username: { contains: q, mode: "insensitive" } } } },
      { owner: { is: { fullName: { contains: q, mode: "insensitive" } } } },
    ];
  }

  const [count, rows] = await Promise.all([
    prisma.playlist.count({ where }),
    prisma.playlist.findMany({
      where,
      orderBy: { [sortBy]: sortType },
      skip,
      take: limit,
      select: {
        id: true,
        name: true,
        description: true,
        isPublic: true,
        isSystem: true,
        videoCount: true,
        totalDuration: true,
        isDeleted: true,
        deletedAt: true,
        createdAt: true,
        updatedAt: true,
        owner: {
          select: {
            id: true,
            fullName: true,
            username: true,
            avatar: true,
            role: true,
            isDeleted: true,
          },
        },
      },
    }),
  ]);

  const items = rows.map((row) => ({
    ...row,
    owner: toUserSummary(row.owner),
  }));

  return res.status(200).json(
    buildSimpleListResponse({
      key: "playlists",
      items,
      page,
      limit,
      totalItems: count,
      message: "Admin playlists fetched",
    })
  );
});

export const getAdminPlaylistById = asyncHandler(async (req, res) => {
  const playlistId = ensureRequiredId(req.params.playlistId, "playlistId");

  const row = await prisma.playlist.findUnique({
    where: { id: playlistId },
    select: {
      id: true,
      name: true,
      description: true,
      isPublic: true,
      isSystem: true,
      videoCount: true,
      totalDuration: true,
      isDeleted: true,
      deletedAt: true,
      createdAt: true,
      updatedAt: true,
      owner: {
        select: {
          id: true,
          fullName: true,
          username: true,
          avatar: true,
          email: true,
          role: true,
          moderationStatus: true,
          isDeleted: true,
        },
      },
      videos: {
        orderBy: { createdAt: "desc" },
        take: 30,
        select: {
          createdAt: true,
          video: {
            select: {
              id: true,
              title: true,
              thumbnail: true,
              duration: true,
              views: true,
              isDeleted: true,
              isPublished: true,
            },
          },
        },
      },
    },
  });

  if (!row) throw new ApiError(404, "Playlist not found");

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        ...row,
        owner: toUserSummary(row.owner),
        videos: row.videos.map((entry) => ({
          addedAt: entry.createdAt,
          video: entry.video,
        })),
      },
      "Admin playlist detail fetched"
    )
  );
});

export const softDeleteAdminPlaylist = asyncHandler(async (req, res) => {
  const playlistId = ensureRequiredId(req.params.playlistId, "playlistId");
  const updated = await runAdminPlaylistSoftDelete({
    req,
    actor: req.user,
    playlistId,
    reason: normalizeOptionalText(req.body?.reason, 500),
  });

  return res.status(200).json(new ApiResponse(200, updated, "Playlist soft deleted"));
});

export const restoreAdminPlaylist = asyncHandler(async (req, res) => {
  const playlistId = ensureRequiredId(req.params.playlistId, "playlistId");
  const updated = await runAdminPlaylistRestore({
    req,
    actor: req.user,
    playlistId,
    reason: normalizeOptionalText(req.body?.reason, 500),
  });

  return res.status(200).json(new ApiResponse(200, updated, "Playlist restored"));
});
