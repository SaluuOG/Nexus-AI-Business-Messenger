export const requests = [];
let response = () => ({ data: null, error: null });
export function setResponse(next) { requests.length = 0; response = next; }
export const supabase = {
  functions: {
    invoke(name, options) {
      const request = { name, ...options };
      requests.push(request);
      return response(request);
    },
  },
};
