export const globalErrorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || "Internal Server Error";

  // Avoid noisy logs for expected client errors (4xx) in production.
  if (statusCode >= 500) {
    console.error("ERROR:", err);
  } else if (process.env.NODE_ENV === "development") {
    console.warn(`Client error ${statusCode}:`, message);
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === "development" && { stack: err.stack })
  });
};
