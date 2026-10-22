// Външни библиотеки се зареждат само когато са нужни (PDF, ZIP, Excel)
(function () {
  const CDN = {
    jspdf: { url: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', ready: () => window.jspdf && window.jspdf.jsPDF },
    jszip: { url: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', ready: () => window.JSZip },
    xlsx: { url: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', ready: () => window.XLSX },
    fonts: { url: '/vendor/onest-fonts.js', ready: () => window.GRAND_FONTS },
  };
  const pending = {};

  function load(name) {
    const lib = CDN[name];
    if (lib.ready()) return Promise.resolve();
    if (pending[name]) return pending[name];
    pending[name] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = lib.url;
      s.async = true;
      s.onload = () => (lib.ready() ? resolve() : reject(new Error('Библиотеката не се зареди: ' + name)));
      s.onerror = () => { delete pending[name]; reject(new Error('Няма връзка за зареждане на ' + name + '. Провери интернета.')); };
      document.head.appendChild(s);
    });
    return pending[name];
  }

  window.GrandLibs = { load: (...names) => Promise.all(names.map(load)) };
})();
