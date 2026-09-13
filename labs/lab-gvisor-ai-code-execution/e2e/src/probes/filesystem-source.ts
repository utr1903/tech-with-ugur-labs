export function canarySource(
	fixture: { path: string; hostPath: string; secret: string; table: string },
	databaseIP: string,
) {
	return `import os,json,socket,time
print('EXECUTED',flush=True)
paths=${JSON.stringify([fixture.path, fixture.hostPath, `/var/run/secrets/${fixture.secret}/canary`])}
for p in paths:
 try:
  with open(p,'rb') as f: print(json.dumps({'path':p,'read':f.read(512).decode('utf-8','replace')}))
 except OSError as e: print(json.dumps({'path':p,'denied':type(e).__name__}))
print(json.dumps({'sensitive_paths_present':{p:os.path.exists(p) for p in ['/var/run/secrets/kubernetes.io/serviceaccount/token','/app/backend','/var/lib/postgresql/data','/var/run/docker.sock','/run/containerd/containerd.sock']}}))
print(json.dumps({'fake_environment':{k:v for k,v in os.environ.items() if k.startswith('E2E_FAKE_') or v.startswith('FAKE-')}}))
import struct,ssl
s=socket.socket();s.settimeout(.3)
try:
 s.connect((${JSON.stringify(databaseIP)},5432))
 startup=b'user\\0chat\\0database\\0chat\\0\\0'
 s.sendall(struct.pack('!II',len(startup)+8,196608)+startup)
 reply=s.recv(512)
 if reply.startswith(b'R\\0\\0\\0\\x08\\0\\0\\0\\0'):
  query=${JSON.stringify(`SELECT value FROM ${fixture.table} WHERE id=1;`)}.encode()+b'\\0'
  s.sendall(b'Q'+struct.pack('!I',len(query)+4)+query)
  print(json.dumps({'database_read':s.recv(512).decode('utf-8','replace')}))
 else: print('DATABASE_AUTH_REQUIRED')
except OSError as e:print('DATABASE_DENIED',type(e).__name__)
finally:s.close()
s=socket.socket();s.settimeout(.3)
try:
 s.connect(('kubernetes.default.svc',443))
 ctx=ssl._create_unverified_context()
 with ctx.wrap_socket(s,server_hostname='kubernetes.default.svc') as conn:
  conn.sendall(${JSON.stringify(`GET /api/v1/namespaces/executor-app/secrets/${fixture.secret} HTTP/1.0\r\nHost: kubernetes.default.svc\r\n\r\n`)}.encode())
  print(json.dumps({'fake_secret_read':conn.recv(512).decode('utf-8','replace')}))
except OSError as e:print('SECRET_DENIED',type(e).__name__)
finally:s.close()
print(open('/proc/mounts').read()[:2048])
print('SOURCE_AND_IMAGE_ALLOWED',os.path.exists('/usr/local/lib/python3.12'))
time.sleep(2)
`;
}
