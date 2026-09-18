const id = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export function issuingRoute(method, path) {
  if (method === "GET")
    return (
      new RegExp(
        `^/admin-api/v1/card-issuing/(suppliers|products|groups|audit)(/${id})?$`,
      ).test(path) ||
      new RegExp(
        `^/(client|admin)-api/v1/customers/${id}/card-issuing/((products|orders|cards)(/${id})?|wallet|terms)$`,
      ).test(path) ||
      new RegExp(
        `^/admin-api/v1/customers/${id}/card-issuing/(enrollment|deposits|audit|reconciliation)$`,
      ).test(path)
    );
  if (method !== "POST") return false;
  return (
    new RegExp(
      `^/admin-api/v1/card-issuing/(suppliers|products|groups)(/${id})?$`,
    ).test(path) ||
    path === "/admin-api/v1/card-issuing/prices" ||
    new RegExp(
      `^/admin-api/v1/customers/${id}/card-issuing/(enrollment|deposits)$`,
    ).test(path) ||
    new RegExp(
      `^/admin-api/v1/customers/${id}/card-issuing/(deposit-reviews|recoveries)/${id}$`,
    ).test(path) ||
    new RegExp(
      `^/client-api/v1/customers/${id}/card-issuing/(quotes|orders|topups)$`,
    ).test(path)
  );
}
