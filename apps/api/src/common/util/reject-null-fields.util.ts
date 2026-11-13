import { Errors } from '../errors/errors';

/**
 * `@IsOptional()` lets `null` through as well as `undefined`, so a PATCH
 * that sends `null` for a column that cannot hold one would otherwise reach
 * the database and fail as a 500. Called with the fields that must not be
 * null, it refuses them as a 400 instead.
 */
export function rejectNullFields<Dto extends object>(
  dto: Dto,
  fields: readonly (keyof Dto & string)[],
): void {
  const problems = fields
    .filter((field) => dto[field] === null)
    .map((field) => ({ field, constraints: [`${field} cannot be null`] }));
  if (problems.length > 0) throw Errors.validationFailed(problems);
}
