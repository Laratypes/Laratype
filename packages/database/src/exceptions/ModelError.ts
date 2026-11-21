/** An invalid use of the Model API: a missing or composite primary key, an unknown column, a bad limit, ... */
export default class ModelError extends Error {
  override name = "ModelError";
}
