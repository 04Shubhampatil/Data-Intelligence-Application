import { z } from "zod";

/** Sign-in name: 3–50 characters, lower case letters, digits, dot, dash, underscore. Case-insensitive at sign-in. */
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Use at least 3 characters")
  .max(50, "Use at most 50 characters")
  .regex(/^[a-z0-9][a-z0-9._-]*$/, "Use letters, numbers, dot, dash or underscore (no spaces)");

export const loginSchema = z.object({
  username: z.string().trim().toLowerCase().min(1, "Username is required").max(50),
  password: z.string().min(1, "Password is required").max(200),
});

export const passwordPolicy = z
  .string()
  .min(12, "Use at least 12 characters")
  .max(200)
  .regex(/[a-z]/, "Include a lowercase letter")
  .regex(/[A-Z]/, "Include an uppercase letter")
  .regex(/\d/, "Include a number");

export const changePasswordSchema = z
  .object({
    current: z.string().min(1, "Enter your current password").max(200),
    password: passwordPolicy,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords do not match" })
  .refine((v) => v.password !== v.current, { path: ["password"], message: "Choose a password different from the current one" });

export type LoginInput = z.infer<typeof loginSchema>;
