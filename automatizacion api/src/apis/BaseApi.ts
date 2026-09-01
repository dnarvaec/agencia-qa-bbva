import { APIRequestContext, APIResponse, test } from '@playwright/test';

/**
 * Clase base del API Object Pattern.
 * Cada recurso/servicio de la API extiende esta clase y expone
 * sus endpoints como métodos con tipos explícitos de request/response.
 *
 * Uso:
 *   class ProductApi extends BaseApi {
 *     async getAll() { return this.get('/products'); }
 *     async getById(id: number) { return this.get(`/products/${id}`); }
 *     async create(payload: CreateProductDto) { return this.post('/products', payload); }
 *   }
 */
export abstract class BaseApi {
  protected readonly request: APIRequestContext;
  protected readonly baseURL: string;

  constructor(request: APIRequestContext, baseURL: string) {
    this.request = request;
    this.baseURL = baseURL;
  }

  /** Construye la URL completa concatenando baseURL + path del endpoint */
  protected url(path: string): string {
    return `${this.baseURL}${path}`;
  }

  /** Adjunta request y response como JSON al reporte HTML de Playwright para auditoría */
  private async _attach(method: string, url: string, reqBody: unknown, res: APIResponse): Promise<void> {
    try {
      // res.body() devuelve el Buffer sin consumir el body (seguro releer después en el test)
      const rawBuffer = await res.body();
      let resBody: unknown;
      try { resBody = JSON.parse(rawBuffer.toString('utf-8')); } catch { resBody = rawBuffer.toString('utf-8'); }
      const payload = { request: { method, url, body: reqBody ?? null }, response: { status: res.status(), body: resBody } };
      await test.info().attach(`${method} ${url} -> ${res.status()}`, {
        contentType: 'application/json',
        body: Buffer.from(JSON.stringify(payload, null, 2)),
      });
    } catch { /* silencioso si se llama fuera de contexto de test */ }
  }

  protected async get(
    path: string,
    params?: Record<string, string | number | boolean>
  ): Promise<APIResponse> {
    const res = await this.request.get(this.url(path), { params });
    await this._attach('GET', this.url(path), params ?? null, res);
    return res;
  }

  protected async post(path: string, data?: unknown): Promise<APIResponse> {
    const res = await this.request.post(this.url(path), { data });
    await this._attach('POST', this.url(path), data, res);
    return res;
  }

  protected async put(path: string, data?: unknown): Promise<APIResponse> {
    const res = await this.request.put(this.url(path), { data });
    await this._attach('PUT', this.url(path), data, res);
    return res;
  }

  protected async patch(path: string, data?: unknown): Promise<APIResponse> {
    const res = await this.request.patch(this.url(path), { data });
    await this._attach('PATCH', this.url(path), data, res);
    return res;
  }

  protected async delete(path: string): Promise<APIResponse> {
    const res = await this.request.delete(this.url(path));
    await this._attach('DELETE', this.url(path), null, res);
    return res;
  }
}

