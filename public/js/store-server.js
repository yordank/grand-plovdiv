// Данни през собствения сървър (Express + SQLite)
(function () {
  async function req(method, url, body) {
    const res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch { /* празен отговор */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Грешка ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  window.GrandStore = {
    mode: 'server',
    async init() {
      const me = await req('GET', '/api/me');
      if (!me.signedIn) return { signedIn: false, canLogin: true };
      return { signedIn: true, canEdit: me.canEdit, user: me.user };
    },
    async login(user, password) {
      const me = await req('POST', '/api/login', { user, password });
      return { signedIn: true, canEdit: me.canEdit, user: me.user };
    },
    logout: () => req('POST', '/api/logout'),
    changePassword: (current, next) => req('POST', '/api/password', { current, next }),
    getObjects: () => req('GET', '/api/objects'),
    saveObjects: (list) => req('PUT', '/api/objects', list),
    listMonths: () => req('GET', '/api/months'),
    getMonth: async (id) => {
      try { return await req('GET', `/api/months/${id}`); } catch (e) { if (e.status === 404) return null; throw e; }
    },
    saveMonth: (id, data) => req('PUT', `/api/months/${id}`, data),
    lockMonth: (id) => req('POST', `/api/months/${id}/lock`),
    unlockMonth: (id) => req('POST', `/api/months/${id}/unlock`),
    deleteMonth: (id) => req('DELETE', `/api/months/${id}`),
    async download(filename, blob) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      return true;
    },
    scriptBase: '',
  };
})();
