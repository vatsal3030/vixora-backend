import nodemailer from "nodemailer";
import ApiError from "./ApiError.js";

export const sendEmail = async ({ to, subject, html, text }) => {
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      connectionTimeout: 20000,
      greetingTimeout: 20000,
      socketTimeout: 20000,
      tls: {
        rejectUnauthorized: false,
      },
    });

    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to,
      subject,
      text,
      html,
    });

    return true;
  } catch (error) {
    console.error("SMTP Email Error:", error.message);
    throw new ApiError(500, "Failed to send email");
  }
};
