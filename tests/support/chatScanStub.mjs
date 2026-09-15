export const requests = [];
let response = () => ({ data: null, error: null });
export function setResponse(next) { requests.length = 0; response = next; }
export const supabase = {
  functions: {
    invoke(name, options) {
      const request = { transport: 'function', name, ...options };
      requests.push(request);
      return response(request);
    },
  },
  rpc(name, args) {
    return {
      abortSignal(signal) {
        const request = { transport: 'rpc', name, args, signal };
        requests.push(request);
        return response(request);
      },
    };
  },
};
