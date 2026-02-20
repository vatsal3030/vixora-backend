import rateLimit from "express-rate-limit";

const standardRateLimitResponse = {
  success: false,
  message: "Too many requests, please try again later."
};

export const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100, // 100 requests per IP
  message: standardRateLimitResponse,
  standardHeaders: true,
  legacyHeaders: false
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: standardRateLimitResponse,
  standardHeaders: true,
  legacyHeaders: false
});

export const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    success: false,
    message: "Too many OTP requests, please try again later."
  },
  standardHeaders: true,
  legacyHeaders: false
});
