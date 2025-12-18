import z, { email } from  "zod";

export const createUserSchema = z.object({
  username: z.string().trim().min(3).max(30).toLowerCase(),
  email: z.string().trim().email().toLowerCase().max(100),
  fullName: z.string().trim().min(3).max(40),
  password: z.string().min(6).max(100),
});

