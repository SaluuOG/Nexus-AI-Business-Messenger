export const requests = [];
export const subscriptions = [];
export let respond = () => ({ data: [], error: null });
export const setResponse = handler => { requests.length = 0; subscriptions.length = 0; respond = handler; };

export const supabase = {
  from(table) {
    const request = { table, operation: 'select', filters: [] };
    requests.push(request);
    const builder = {
      insert(value) { request.operation = 'insert'; request.value = value; return this; },
      update(value) { request.operation = 'update'; request.value = value; return this; },
      delete() { request.operation = 'delete'; return this; },
      select(columns) { request.columns = columns; return this; },
      eq(...filter) { request.filters.push(filter); return this; },
      order(column, options) { (request.orders ??= []).push([column, options]); return this; },
      limit(value) { request.limit = value; return this; },
      or(value) { request.or = value; return this; },
      gt(column, value) { request.gt = [column, value]; return this; },
      abortSignal(signal) { request.signal = signal; return this; },
      range(from, to) { request.range = [from, to]; return this; },
      single() { return this; }, maybeSingle() { return this; },
      then(resolve, reject) { return Promise.resolve(respond(request)).then(resolve, reject); },
    };
    return builder;
  },
  rpc(name, args) { const request = { rpc: name, args }; requests.push(request); return Promise.resolve(respond(request)); },
  channel(name) {
    const channel = { name, on(type, filter, callback) { subscriptions.push({ type, filter, callback }); return this; }, subscribe(callback) { callback?.('SUBSCRIBED'); return this; } };
    return channel;
  },
  removeChannel() {},
};
