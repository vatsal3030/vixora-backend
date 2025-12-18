class ApiError extends Error {
    constructor(
        statusCode,
        message = "something went wrong",
        errors = [],
        stack = "") {
        super(message);
        this.statusCode = statusCode;
        this.data = null;
        this.errors = errors;
        this.sucess = false;
        if (stack) {
            this.stack = stack;
        } else {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}

export default ApiError