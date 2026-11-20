// Defaults for the `MEDIA_*` variables, shared by the Joi schema
// (`env.validation.ts`) and the typed config (`configuration.ts`) so the two
// cannot disagree. Each is the value used when the variable is unset.
export const MEDIA_DEFAULTS = {
  // Every laptop of a church holds every one of its videos, so this also
  // bounds the disk each laptop gives them.
  workspaceQuotaBytes: 20 * 1024 * 1024 * 1024,
} as const;
