export const globalErrorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || "Internal Server Error";
  const isDev = process.env.NODE_ENV === "development";
  const safeMessage = statusCode >= 500 && !isDev ? "Internal Server Error" : message;

  // Avoid noisy logs for expected client errors (4xx) in production.
  if (statusCode >= 500) {
    console.error("ERROR:", err);
  } else if (isDev) {
    console.warn(`Client error ${statusCode}:`, message);
  }

  res.status(statusCode).json({
    success: false,
    message: safeMessage,
    ...(isDev && { stack: err.stack })
  });
};
