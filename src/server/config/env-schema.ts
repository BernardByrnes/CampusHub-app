import { z } from "zod";

const postgresConnectionString = z
  .string()
  .trim()
  .min(1, "DATABASE_URL is required")
  .refine(
    (value) => {
      try {
        const protocol = new URL(value).protocol;
        return protocol === "postgres:" || protocol === "postgresql:";
      } catch {
        return false;
      }
    },
    "DATABASE_URL must be a valid PostgreSQL connection URL",
  );

export const serverEnvSchema = z.object({
  DATABASE_URL: postgresConnectionString,
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(
  rawEnvironment: Readonly<Record<string, string | undefined>>,
): ServerEnv {
  return serverEnvSchema.parse(rawEnvironment);
}
