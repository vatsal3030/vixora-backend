export const sanitizeSort = (sortBy, sortType, allowedFields, defaultField) => {

    if (!allowedFields.includes(sortBy)) {
        sortBy = defaultField;
    }

    sortType = sortType === "asc" ? "asc" : "desc";

    return { sortBy, sortType };
};
