type BaseControllerDefaultResponse<T> = Promise<T | null>;

interface IBaseController<T> {
  all(lookup?: LookupsConfig<T>): Promise<T[] | null>;
  get(lookup: LookupValues<T>): BaseControllerDefaultResponse<T>;
  create(data: CreateValues<T>): BaseControllerDefaultResponse<T>;
  update(lookup: LookupValues<T>, data: UpdateValues<T>): BaseControllerDefaultResponse<T>;
  delete(lookup: LookupValues<T>): Promise<boolean>;
}

/**
 * Resultado de operação que pode falhar de formas distinguíveis (mesma ideia do
 * `{ ok, reason }` do auth-controller). A rota mapeia `reason` -> StatusCode e
 * devolve `message` (pt-BR) tal como veio do domínio/codec.
 */
type ServiceFailureReason = "not_found" | "validation" | "server_error";
type ServiceFailure = { ok: false; reason: ServiceFailureReason; message: string };
type ServiceResult<T> = { ok: true; data: T } | ServiceFailure;