import { ApiError, createApiClient } from '@hwn/api-client';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

export const api = createApiClient({ baseURL: API_BASE_URL });

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return 'Đã có lỗi xảy ra';
}
