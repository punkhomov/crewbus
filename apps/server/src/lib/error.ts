export class AppError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string) {
    super(message);
  }
}
export const invalid = (message = 'Invalid input'): never => {
  throw new AppError(400, 'invalid_input', message);
};
export const missing = (): never => {
  throw new AppError(404, 'not_found', 'Resource not found');
};
export const conflict = (message = 'Conflicting operation'): never => {
  throw new AppError(409, 'conflict', message);
};
