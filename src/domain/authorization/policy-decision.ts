export type PolicyDecision<
  TMetadata extends Record<string, unknown> = Record<string, never>,
> =
  | {
      readonly allowed: true;
      readonly code: "ALLOWED";
      readonly metadata?: TMetadata;
    }
  | {
      readonly allowed: false;
      readonly code: string;
      readonly metadata?: TMetadata;
    };
