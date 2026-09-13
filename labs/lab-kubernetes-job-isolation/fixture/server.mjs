import { createServer } from 'node:http';

const marker = "printf 'SIMULATED_DOWNLOAD_MARKER\\n'\n";
function log(fields) {
  process.stdout.write(`${JSON.stringify({timestamp:new Date().toISOString(),...fields})}\n`);
}
const server = createServer((request,response) => {
  // The fixture only returns fixed bytes; it never invokes a shell.
  const path = request.url === '/marker.sh' ? '/marker.sh' : '<other>';
  log({path,source:request.socket.remoteAddress ?? '<unknown>'});
  if(request.method === 'GET' && path === '/marker.sh') {
    response.writeHead(200, {'content-type':'text/plain'});
    response.end(marker);
  } else { response.writeHead(404); response.end(); }
});
server.on('error', () => {log({event:'listener-failed'}); process.exit(1);});
server.listen(Number(process.env.PORT ?? '8080'), '0.0.0.0', () => {
  log({event:'listening',port:server.address().port});
});
process.on('SIGTERM', () => server.close(()=>process.exit(0)));
