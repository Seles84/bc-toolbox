/** Typed client for the background API. */
import type { ApiEndpoint, ApiEndpoints, ApiRequest, ApiResponse } from '@/shared/protocol';

export async function api<E extends ApiEndpoint>(
    endpoint: E,
    params: ApiEndpoints[E]['params'],
): Promise<ApiEndpoints[E]['result']> {
    const request: ApiRequest<E> = { kind: 'bct-api', endpoint, params };
    const response = (await chrome.runtime.sendMessage(request)) as ApiResponse<E> | undefined;
    if (!response) {
        throw new Error('No response from background');
    }
    if (!response.ok) {
        throw new Error(response.error);
    }
    return response.data;
}
