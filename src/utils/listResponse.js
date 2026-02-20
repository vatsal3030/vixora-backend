const toPositiveInt = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
};

export const buildPaginationMeta = ({
  currentPage = 1,
  limit = 10,
  totalItems = 0,
}) => {
  const safePage = toPositiveInt(currentPage, 1);
  const safeLimit = toPositiveInt(limit, 10);
  const safeTotal = Math.max(0, Number(totalItems) || 0);
  const totalPages = safeTotal > 0 ? Math.ceil(safeTotal / safeLimit) : 0;

  return {
    currentPage: safePage,
    page: safePage, // legacy alias
    itemsPerPage: safeLimit,
    limit: safeLimit, // legacy alias
    totalItems: safeTotal,
    total: safeTotal, // legacy alias
    totalPages,
    hasPrevPage: safePage > 1 && totalPages > 0,
    hasNextPage: safePage < totalPages,
  };
};

export const buildPaginatedListData = ({
  key = "items",
  items = [],
  currentPage = 1,
  limit = 10,
  totalItems = 0,
  legacyTotalKey,
  includeKeyAlias = false,
  extra = {},
}) => {
  const pagination = buildPaginationMeta({
    currentPage,
    limit,
    totalItems,
  });

  if (legacyTotalKey) {
    pagination[legacyTotalKey] = pagination.totalItems;
  }

  const payload = {
    ...extra,
    items,
    pagination,
  };

  // Keep resource alias optional to avoid duplicated arrays in API payload.
  // By default all list endpoints return normalized shape: { items, pagination }.
  if (includeKeyAlias && key && key !== "items") {
    payload[key] = items;
  }

  return payload;
};
