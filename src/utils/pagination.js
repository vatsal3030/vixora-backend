export const sanitizePagination = (page, limit, maxLimit = 100) => {
    page = Number(page);
    limit = Number(limit);

    if (!Number.isInteger(page) || page < 1) page = 1;
    if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) limit = 20;

    return {
        page,
        limit,
        skip: (page - 1) * limit
    };
};
