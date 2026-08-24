'use strict';
/* Traktor Pro — on se fait passer pour un serveur Icecast local.
   Dans Traktor : Preferences > Broadcasting
     Address 127.0.0.1  Port 8000  Mount /liaison  Password liaison
   Traktor pousse les metadonnees sur /admin/metadata a chaque changement. */
const http = require('http');

function start(opts, cb) {
  const port = opts.port || 8000;
  const server = http.createServer((req, res) => {
    try {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname === '/admin/metadata') {
        const song = u.searchParams.get('song') || '';
        if (song) cb.onText(song, {});
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end('<?xml version="1.0"?><iceresponse><message>ok</message><return>1</return></iceresponse>');
        return;
      }
    } catch (e) {}
    // flux audio : on accepte et on jette, seules les metadonnees nous interessent
    req.resume();
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
  });
  server.on('error', e => cb.onStatus({ ok: false, msg: 'Port ' + port + ' occupe : ' + e.code }));
  server.listen(port, '127.0.0.1', () =>
    cb.onStatus({ ok: true, msg: 'En ecoute sur 127.0.0.1:' + port + ' (mount /liaison)' }));
  return { stop: () => { try { server.close(); } catch (e) {} } };
}
module.exports = { start };
