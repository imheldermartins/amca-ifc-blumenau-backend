type BaseControllerDefaultResponse<T> = Promise<T | null>;

interface IBaseController<T> {
  all(lookup?: LookupsConfig<T>): Promise<T[] | null>;
  get(lookup: LookupValues<T>): BaseControllerDefaultResponse<T>;
  create(data: CreateValues<T>): BaseControllerDefaultResponse<T>;
  update(lookup: LookupValues<T>, data: UpdateValues<T>): BaseControllerDefaultResponse<T>;
  delete(lookup: LookupValues<T>): Promise<boolean>;
}
