const LAST_APPLIED = "kubectl.kubernetes.io/last-applied-configuration";
const MAX_STRING = 2000;

type Json = unknown;
type Obj = Record<string, Json>;

function isObj(v: Json): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function redactEnv(env: Json[]): Json[] {
  return env.map((e) =>
    isObj(e) && typeof e.value === "string"
      ? { ...e, value: `<redacted len=${e.value.length}>` }
      : e,
  );
}

function slimConditions(conditions: Json[]): Json[] {
  return conditions.map((c) =>
    isObj(c) ? { type: c.type, status: c.status } : c,
  );
}

function cleanMetadata(meta: Obj): Obj {
  const { managedFields: _m, annotations, ...rest } = meta;
  if (!isObj(annotations)) return rest;
  const { [LAST_APPLIED]: _l, ...kept } = annotations;
  return { ...rest, annotations: kept };
}

function walk(value: Json, key: string, parentKey: string): Json {
  if (typeof value === "string") {
    return value.length > MAX_STRING
      ? `${value.slice(0, MAX_STRING)}...[truncated ${value.length - MAX_STRING} chars]`
      : value;
  }
  if (Array.isArray(value)) {
    const items =
      key === "env"
        ? redactEnv(value)
        : key === "conditions" && parentKey === "status"
          ? slimConditions(value)
          : value;
    return items.map((v) => walk(v, key, parentKey));
  }
  if (isObj(value)) {
    const obj = key === "metadata" ? cleanMetadata(value) : value;
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, walk(v, k, key)]),
    );
  }
  return value;
}

/**
 * Makes a Kubernetes object safe to show the model: env values and
 * last-applied annotations can embed credentials, managedFields is noise,
 * and very long strings are cut. Dates become ISO strings first.
 */
export function sanitizeObject(obj: unknown): unknown {
  return walk(JSON.parse(JSON.stringify(obj)), "", "");
}
