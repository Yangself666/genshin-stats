import type { APIResponse, DSOptions } from '../typings';
import { URL } from 'url';
import { fetch, Headers, AbortController } from './fetch-undici';
import { getDS, getDS2, getHTTPRequestHeaders, getUserAgent } from './get-ds';
import { AbortError, APIError, buildQueryString, Cancelable, ExtensibleRequestFunction, extractUrlSearchParams, HTTPError, RequestOptions } from './request-common';
import hasOwn from './has-own';
import { USER_AGENT_WINDOWS_CRHOME } from './user-agent';

export const request = function(url: string | URL, options?: RequestOptions): Cancelable<any> {
  if (options?.prefixUrl) {
    // implicit type conversion
    url = new URL(url as string, options.prefixUrl);
  }

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const init: RequestInit = {
    signal: controller.signal,
  };

  if (options) {
    init.method = options.method || 'GET';

    if (options.searchParams) {
      if (typeof url === 'string') {
        url = new URL(url);
      }
      url.search = buildQueryString(options.searchParams);
    }

    if (options.followRedirect === false) {
      init.redirect = 'manual';
    }

    let content_type: string | undefined;
    if (options.body) {
      init.body = options.body;

    } else if (options.json) {
      init.body = JSON.stringify(options.json);
      content_type = 'application/json';

    } else if (options.form) {
      init.body = buildQueryString(options.form);
      content_type = 'application/x-www-form-urlencoded';
    }

    const headers = init.headers = new Headers(options.headers);
    if (content_type || options.ds || options.client_type) {
      if (content_type && !headers.has('Content-Type')) {
        headers.set('Content-Type', content_type);
      }

      if (!headers.has('User-Agent')) {
        headers.set('User-Agent', getUserAgent(options.ds || options as DSOptions) || USER_AGENT_WINDOWS_CRHOME);
      }

      let ds: string | undefined;
      if (options.ds) {
        ds = options.ds.ds2 || options.ds2
          ? getDS2(init.body as string, extractUrlSearchParams(url), options.ds)
          : getDS(options.ds);

      } else if (options.client_type) {
        ds = options.ds2
          ? getDS2(init.body as string, extractUrlSearchParams(url), options.client_type, options.app_version)
          : getDS(options.client_type, options.app_version);
      }

      if (ds) {
        if (!headers.has('DS')) {
          headers.set('DS', ds);
        }

        const extra_headers = getHTTPRequestHeaders(options.ds || options as DSOptions);
        for (const name in extra_headers) {
          if (!headers.has(name) && hasOwn(extra_headers, name)) {
            headers.set(name, extra_headers[name]);
          }
        }
      }
    }

    if (options.signal) {
      options.signal.addEventListener('abort', () => controller.abort());
    }

    if (options.timeout) {
      timeout = setTimeout(() => controller.abort(), options.timeout);
    }
  }

  const cancelable = (options?.cookieJar ? options.cookieJar.getCookieString(url + '') : Promise.resolve())
    .then((cookie: string | void) => {
      if (cookie) {
        (init.headers! as Headers).set('Cookie', cookie);
      }
      if (options?.resolveUrl) {
        url = options.resolveUrl(url, options);
      }
      return fetch(url as string, init);
    })
    .then(response => {
      if (timeout) {
        clearInterval(timeout);
      }

      if (!response.ok && options?.throwHttpErrors !== false) {
        throw new HTTPError(response);
      }

      let body: Promise<unknown> | undefined;
      if (options) {
        switch (options.responseType) {
          case 'text': body = response.text(); break;
          case 'json':
            body = response.json().then((data: APIResponse<unknown>) => {
              if (data.retcode != null) {
                if (data.retcode) {
                  throw new APIError(data.message, data.retcode);
                }
                return data.data;
              }
              return data;
            });
            break;
          case 'buffer':
          case 'arraybuffer': body = response.arrayBuffer(); break;
          case 'formdata': body = response.formData(); break;
        }

        if (options.resolveBodyOnly && body) {
          return body;
        }
      }

      if (body) {
        return body.then(data => ({
          ok: response.ok,
          url: response.url,
          status: response.status,
          statusText: response.statusText,
          redirected: response.redirected,
          headers: response.headers,
          body: data,
        }));
      }

      return response;

    }, (reason: any) => {
      if (timeout) {
        clearInterval(timeout);
      }

      if (reason && reason.name === 'AbortError') {
        return Promise.reject(new AbortError(reason.message));
      }

      return Promise.reject(reason);
    }) as unknown as Cancelable<unknown>;

  Object.defineProperty(cancelable, 'isCanceled', {
    get: () => controller.signal.aborted,
  });

  cancelable.cancel = () => controller.abort();

  return cancelable;

} as ExtensibleRequestFunction;

request.extend = function(defaults: RequestOptions) {
  return (url: string | URL, options?: RequestOptions) => request(url, { ...defaults, ...options } as any) as any;
};

export default request;
export type { RequestOptions, HTTPError, APIError, AbortError, UserCancelHandler } from './request-common';
