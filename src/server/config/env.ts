import "server-only";

import { parseServerEnv, type ServerEnv } from "./env-schema";

let cachedEnvironment: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  cachedEnvironment ??= parseServerEnv(process.env);
  return cachedEnvironment;
}
