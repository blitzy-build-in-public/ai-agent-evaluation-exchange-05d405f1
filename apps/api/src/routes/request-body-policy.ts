/**
 * The request-body policy of the API: the one check that holds a write body to the JSON types and the
 * fields its schema declares, before Fastify's own validator reshapes it.
 *
 * **Why it exists.** `apps/api/src/server.ts` builds the instance with `Fastify({ logger: { level:
 * "info" } })` and overrides none of the Ajv defaults `node_modules/@fastify/ajv-compiler/lib/
 * default-ajv-options.js` sets — `coerceTypes: 'array'`, `useDefaults: true`, `removeAdditional:
 * true`. Two consequences follow on a write route, and both are invisible to the client that caused
 * them:
 *
 * - `coerceTypes` converts a value into the type its schema declares, so `{"title": 123}` against a
 *   field declared `{ type: 'string' }` reaches the handler as the string `"123"` and is stored that
 *   way.
 * - `removeAdditional` **removes** an own field the body does not declare instead of refusing it, so
 *   a misspelled or unmodelled field is dropped before the handler runs and the client is answered
 *   `201` as though it had been accepted.
 *
 * The contract the schemas of `packages/shared/src/schemas/` publish says the opposite: each write
 * body declares a type per field and `additionalProperties: false`. A body that does not hold those
 * declarations is refused here, through the same `ApiError.validation()` and therefore the same
 * `400 validation_error` and the same sentence every other body rejection leaves the server's single
 * error handler by. No new code, message or error body is introduced: a client is told that what it
 * sent was not accepted rather than being told nothing.
 *
 * **Why a policy of this workspace's own rather than a validator setting.** Turning `coerceTypes` or
 * `removeAdditional` off for the whole instance would break the query contract the same schemas
 * document: a query string always hands its values over as text —
 * `listingSearchQuerySchema` declares `page` as `integer` with a `default` — so the tolerant default
 * is what the query row depends on, and the pager reads a number. A query parameter, a path parameter
 * and a header are text on the wire and are deliberately left to the validator exactly as designed;
 * this module judges a request **body** alone, and within a body it judges only the two facts above,
 * because the validator already reports every other schema failure.
 *
 * **What it deliberately is not.** It is not a second validator: it reads no schema library, compiles
 * nothing, resolves no `$ref` and knows no vocabulary of its own. {@link holdsDeclaredTypes} is
 * partial by design — it judges a value's JSON type and the declared fields of an object, and accepts
 * everything it does not model — so anything it does not refuse falls through to the validator and is
 * answered exactly as it was before this module existed. Nothing here logs: the route handler already
 * records a refusal, and a second record of one failure would be the same fact twice.
 */

import type { FastifyInstance } from "fastify";

import { ApiError } from "../errors/error-envelope";

/**
 * Whether a value's JSON type is one of the names a schema fragment declares, keyed by the name the
 * fragment writes.
 *
 * The seven names are the JSON types of a body as it arrives parsed: `null`, `array`, `string`,
 * `boolean`, `integer` and `number` for the numbers, and `object` for a non-null, non-array object.
 * A declared `number` accepts an integer; a declared `integer` requires one. A number that is not
 * finite is a `NaN` or an `Infinity` rather than a JSON number, so it holds neither name.
 *
 * A name this record does not carry is a type this predicate does not model — JSON Schema's dialect
 * permits one a validator would refuse at compile time, and a body declaring one would never reach
 * here — so such a name is ignored and states nothing rather than refusing every value.
 */
const DECLARED_TYPE_MATCHERS: Readonly<Record<string, (value: unknown) => boolean>> = Object.freeze(
  {
    null: (value: unknown): boolean => value === null,
    array: (value: unknown): boolean => Array.isArray(value),
    string: (value: unknown): boolean => typeof value === "string",
    boolean: (value: unknown): boolean => typeof value === "boolean",
    integer: (value: unknown): boolean => typeof value === "number" && Number.isInteger(value),
    number: (value: unknown): boolean => typeof value === "number" && Number.isFinite(value),
    object: (value: unknown): boolean =>
      typeof value === "object" && value !== null && !Array.isArray(value),
  },
);

/**
 * The `type` names a fragment declares, in the two spellings JSON Schema allows: one name, or an
 * array of names.
 *
 * A `type` written as anything else — absent, or a value that is not a string and not an array —
 * states no name this predicate judges, which is why the answer is an empty list rather than a
 * refusal.
 */
function declaredTypeNames(fragment: Record<string, unknown>): readonly string[] {
  const declared = fragment["type"];

  if (typeof declared === "string") {
    return [declared];
  }

  if (Array.isArray(declared)) {
    return declared.filter((name): name is string => typeof name === "string");
  }

  return [];
}

/**
 * Whether the value holds one of the JSON types the fragment declares.
 *
 * A fragment that declares no type this predicate models constrains nothing here, so the value holds
 * — the partial-predicate rule, stated once in {@link holdsDeclaredTypes}.
 */
function holdsOneDeclaredType(fragment: Record<string, unknown>, value: unknown): boolean {
  const matchers = declaredTypeNames(fragment)
    .map((name) => DECLARED_TYPE_MATCHERS[name])
    .filter((matcher): matcher is (value: unknown) => boolean => matcher !== undefined);

  if (matchers.length === 0) {
    return true;
  }

  return matchers.some((matcher) => matcher(value));
}

/**
 * Whether a value holds the JSON types its schema fragment declares, and carries no field the
 * fragment refuses.
 *
 * **The rule, in full.** A schema that is not a plain object states nothing and the value holds. A
 * fragment declaring `type` is held to it: the value's JSON type must be one of the names, and a name
 * this predicate does not model is ignored. Where the value is a plain object and the fragment
 * declares `properties`, every own key of the value must be a declared property — recursing into that
 * property's own fragment — and a key that is not declared is accepted only when the fragment does
 * not declare `additionalProperties: false`, which refuses it. Where the value is an array and the
 * fragment declares `items` as a plain object, every element is held to that fragment in turn. Every
 * other keyword belongs to the validator: a fragment carrying no `type` this predicate models — an
 * unconstrained `{}`, a `const`, an `enum`, a `pattern`, a `contains`, a `required` with no `type` —
 * states nothing it judges, so the value holds and the validator answers for it exactly as before.
 *
 * **It is deliberately partial, and it must stay so.** The value is accepted whenever this predicate
 * does not model what the schema says: the answer is "not this predicate's business", and the
 * validator's own refusal is the one the client receives. A later reader tempted to make this a full
 * validator — to implement `enum`, `pattern`, `format`, `required` or `$ref` here — would be writing
 * the second validator the module header rejects, and would change the status, code or sentence of
 * failures the contract already fixes. Anything added below must state a fact about the JSON *type*
 * of a value or about the *fields* of an object, and nothing else.
 *
 * It never throws, for a fragment or a value of any type: every read of the fragment is guarded by a
 * plain-object test, so a schema that is a string, an array or `null`, and a value of any type
 * whatever, are answered rather than raised over.
 *
 * @param schema - The schema fragment the body or one of its members is validated against, as the route
 *   carries it — the raw object, not a compiled validator.
 * @param value - The parsed value to judge.
 * @returns `true` when the value holds every type the fragment declares and carries no field the
 *   fragment refuses; `false` only when it does not.
 */
export function holdsDeclaredTypes(schema: unknown, value: unknown): boolean {
  // A fragment that is not a plain object — absent, `null`, a string, an array — states nothing to
  // judge, and this is the guard every read below relies on to stay total.
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    return true;
  }

  const fragment = schema as Record<string, unknown>;

  if (!holdsOneDeclaredType(fragment, value)) {
    return false;
  }

  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const properties = fragment["properties"];

    if (typeof properties === "object" && properties !== null && !Array.isArray(properties)) {
      const declared = properties as Record<string, unknown>;
      const refusesUndeclared = fragment["additionalProperties"] === false;
      const members = value as Record<string, unknown>;

      for (const key of Object.keys(members)) {
        if (!Object.prototype.hasOwnProperty.call(declared, key)) {
          // An undeclared field is refused only where the fragment says the object is closed, which
          // is what `additionalProperties: false` means and what every write body of this API
          // declares. Where it is absent or `true`, the field is the validator's business, not this
          // predicate's.
          if (refusesUndeclared) {
            return false;
          }

          continue;
        }

        if (!holdsDeclaredTypes(declared[key], members[key])) {
          return false;
        }
      }
    }
  }

  if (Array.isArray(value)) {
    const items = fragment["items"];

    if (typeof items === "object" && items !== null && !Array.isArray(items)) {
      for (const element of value) {
        if (!holdsDeclaredTypes(items, element)) {
          return false;
        }
      }
    }
  }

  return true;
}

/**
 * Registers the scope's request-body policy: one `preValidation` hook that refuses a write body whose
 * declared types it does not hold or which carries a field its schema refuses.
 *
 * **Why `preValidation`.** The hook runs after Fastify has parsed the body and before the validator
 * has touched it, which is the last moment the body is still what the client sent — `coerceTypes` and
 * `removeAdditional` both rewrite it during validation. Handing `ApiError.validation()` to the hook's
 * callback is answered by the composition root's single error handler exactly as a schema failure is:
 * status `400`, code `validation_error`, one sentence, no detail.
 *
 * **What it does nothing about.** A route whose schema declares no `body` — every read of this API,
 * and a write whose body a later contract adds without a schema — and a request that carried no body
 * at all are both left alone: the schema's own `required` and `type` answer those cases exactly as
 * they did before, and a missing body is the validator's `400`, not this hook's.
 *
 * Registered inside the encapsulated `/api/v1` scope, so it governs the fourteen route groups of this
 * folder and nothing else: the static handler and the SPA fallback are the composition root's routes
 * and are not reached by it.
 *
 * @param app - The instance to register the hook on. It is the encapsulated scope of
 *   `./register-routes`, whose routes are the ones the policy governs.
 */
export function registerRequestBodyPolicy(app: FastifyInstance): void {
  app.addHook("preValidation", (request, _reply, done): void => {
    const schema = request.routeOptions.schema?.body;

    if (schema === undefined || request.body === undefined) {
      done();
      return;
    }

    if (!holdsDeclaredTypes(schema, request.body)) {
      done(ApiError.validation());
      return;
    }

    done();
  });
}
