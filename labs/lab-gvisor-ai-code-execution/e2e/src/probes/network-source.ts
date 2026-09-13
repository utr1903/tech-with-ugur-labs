export type Target = {
	name: string;
	address: string;
	port: number;
	protocol: "tcp" | "udp";
	payload: "http" | "pg" | "dns" | "echo";
};
export function networkSource(target: Target, nonce: string) {
	return `import socket,json,struct\nprint('EXECUTED',flush=True)\nt=json.loads(${JSON.stringify(JSON.stringify(target))})\nnonce=${JSON.stringify(nonce)}\npayload=('GET /'+nonce+' HTTP/1.0\\r\\nHost: localhost\\r\\n\\r\\n').encode()\nif t['payload']=='pg':\n data=struct.pack('!I',196608)+b'user\\0'+nonce.encode()+b'\\0database\\0postgres\\0\\0'; payload=struct.pack('!I',len(data)+4)+data\nif t['payload']=='dns':\n label=nonce.encode(); payload=struct.pack('!HHHHHH',23456,256,1,0,0,0)+bytes([len(label)])+label+b'\\0'+struct.pack('!HH',1,1)\n if t['protocol']=='tcp': payload=struct.pack('!H',len(payload))+payload\ns=socket.socket(socket.AF_INET,socket.SOCK_STREAM if t['protocol']=='tcp' else socket.SOCK_DGRAM);s.settimeout(1)\ntry:\n s.connect((t['address'],t['port']));s.sendall(payload);data=s.recv(1024);print(json.dumps({'reached':len(data)>0,'received':len(data),'nonce':nonce}))\nexcept OSError as e: print(json.dumps({'reached':False,'errno':e.errno,'nonce':nonce}))\nfinally:s.close()`;
}
