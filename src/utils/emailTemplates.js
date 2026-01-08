export const restoreOtpTemplate = ({
  fullName,
  otp
}) => ({
  subject: "Your Vixora Account Restore OTP",
  html: `
    <div style="font-family: Arial, sans-serif; line-height: 1.5;">
      <h2>Hi from Vixora 👋</h2>
      <p>Hi <strong>${fullName}</strong>,</p>
      <p>Your OTP for account restore is:</p>
      <h3 style="letter-spacing: 3px;">${otp}</h3>
      <p>This code is valid for 5 minutes.</p>
      <p>If you did not request this, you can ignore this email.</p>
    </div>
  `,
});


export const emailVerificationOtpTemplate = ({
  fullName,
  otp,
}) => ({
  subject: "Verify your Vixora account",
  html: `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
    <h2 style="color: #111;">Welcome to Vixora 👋</h2>

    <p>Hi <strong>${fullName}</strong>,</p>

    <p>Thank you for creating your Vixora account.  
    Please verify your email address using the OTP below:</p>

    <div style="
      margin: 20px 0;
      padding: 15px;
      background: #f4f6f8;
      border-radius: 8px;
      text-align: center;
      font-size: 24px;
      letter-spacing: 6px;
      font-weight: bold;
    ">
      ${otp}
    </div>

    <p>This OTP is valid for <strong>5 minutes</strong>.</p>

    <p>If you did not create this account, you can safely ignore this email.</p>

    <hr style="margin: 30px 0;" />

    <p style="font-size: 12px; color: #666;">
      This is an automated message. Please do not reply.
    </p>

    <p style="font-size: 12px; color: #666;">
      © ${new Date().getFullYear()} Vixora
    </p>
  </div>
  `,
});

export const welcomeEmailTemplate = ({ fullName }) => ({
  subject: "Welcome to Vixora 🎉",
  html: `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
    <h2 style="color: #111;">Welcome to Vixora 🎬</h2>

    <p>Hi <strong>${fullName}</strong>,</p>

    <p>Your email has been successfully verified.</p>

    <p>You can now:</p>
    <ul>
      <li>Upload and watch videos</li>
      <li>Create playlists</li>
      <li>Subscribe to creators</li>
      <li>Explore trending content</li>
    </ul>

    <p>We’re excited to have you on Vixora 🚀</p>

    <hr style="margin: 30px 0;" />

    <p style="font-size: 12px; color: #666;">
      Need help? Just visit our platform.
    </p>

    <p style="font-size: 12px; color: #666;">
      © ${new Date().getFullYear()} Vixora
    </p>
  </div>
  `,
});

export const forgotPasswordOtpTemplate = ({ fullName, otp }) => ({
  subject: "Reset your Vixora password",
  html: `
  <div style="font-family: Arial, sans-serif; max-width:600px; margin:auto;">
    <h2>Password Reset Request 🔐</h2>

    <p>Hi <strong>${fullName}</strong>,</p>

    <p>We received a request to reset your Vixora password.</p>

    <div style="
      margin:20px 0;
      padding:15px;
      background:#f4f6f8;
      text-align:center;
      font-size:24px;
      letter-spacing:6px;
      font-weight:bold;
    ">
      ${otp}
    </div>

    <p>This OTP is valid for <strong>5 minutes</strong>.</p>

    <p>If you did not request this, you can ignore this email.</p>

    <hr />
    <p style="font-size:12px;color:#666">
      © ${new Date().getFullYear()} Vixora
    </p>
  </div>
  `,
});


