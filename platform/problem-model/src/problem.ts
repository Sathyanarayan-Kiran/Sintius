import { PROBLEM_CATALOG, isRegisteredProblemCode, type ProblemCode, type ProblemStatus } from "./catalog.ts";

export type { ProblemCode, ProblemStatus } from "./catalog.ts";

/** Field-level validation detail; `path` is a JSON Pointer into the rejected request. */
export interface ProblemFieldError {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: ProblemStatus;
  readonly code: ProblemCode;
  readonly detail: string;
  readonly correlation_id?: string;
  readonly errors?: readonly ProblemFieldError[];
}

export const PROBLEM_CONTENT_TYPE = "application/problem+json";

export class PlatformProblem extends Error {
  readonly problem: Readonly<ProblemDetails>;

  constructor(details: ProblemDetails) {
    super(details.detail);
    if (!isRegisteredProblemCode(details.code)) {
      throw new TypeError(`Problem code "${details.code}" is not registered in PROBLEM_CATALOG.`);
    }
    const entry = PROBLEM_CATALOG[details.code];
    if (details.status !== entry.status || details.title !== entry.title) {
      throw new TypeError(`Problem "${details.code}" must use the cataloged status ${entry.status} and title "${entry.title}".`);
    }
    this.name = "PlatformProblem";
    const { errors, ...rest } = details;
    this.problem = Object.freeze({
      ...rest,
      ...(errors === undefined ? {} : { errors: Object.freeze(errors.map((error) => Object.freeze({ ...error }))) }),
    });
  }

  toJSON(): Readonly<ProblemDetails> {
    return this.problem;
  }
}

export interface ProblemInput {
  readonly code: ProblemCode;
  readonly detail: string;
  readonly status?: ProblemStatus;
  readonly title?: string;
  readonly type?: string;
  readonly correlation_id?: string;
  readonly errors?: readonly ProblemFieldError[];
}

/** Builds a problem from the catalog; status and title default to the registered contract. */
export function problem(input: ProblemInput): PlatformProblem {
  const entry = isRegisteredProblemCode(input.code) ? PROBLEM_CATALOG[input.code] : undefined;
  return new PlatformProblem({
    type: input.type ?? `https://errors.sintius.example/${input.code}`,
    title: input.title ?? entry?.title ?? "",
    status: input.status ?? (entry?.status as ProblemStatus),
    code: input.code,
    detail: input.detail,
    ...(input.correlation_id === undefined ? {} : { correlation_id: input.correlation_id }),
    ...(input.errors === undefined ? {} : { errors: input.errors }),
  });
}
