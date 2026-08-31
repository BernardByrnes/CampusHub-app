export type HealthResponse = Readonly<{
  status: "ok";
}>;

export function getHealth(): HealthResponse {
  return { status: "ok" };
}
