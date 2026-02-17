export const sanitizePagination = (page, limit, maxLimit = 50) => {
    page = Number(page);
    limit = Number(limit);

    if (!Number.isInteger(page) || page < 1) page = 1;
    if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) limit = 10;

    return {
        page,
        limit,
        skip: (page - 1) * limit
    };
};
