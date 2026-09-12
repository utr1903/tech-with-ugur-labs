import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { docker, node, save } from "./commands.js";

const marker = `contained-chat-e2e-${randomUUID().slice(0, 12)}`;
const directory = `/var/tmp/${marker}`;
const rules: string[][] = [];
let created = false;
const listenerScript = `import socket,threading,json,time,os,sys
from pathlib import Path
root=Path('${directory}')
(root/'packets.jsonl').touch()
def record(data):
 if b'e2eprobe' in data:
  with (root/'packets.jsonl').open('a') as f: f.write(json.dumps({'hex':data.hex(),'time':time.time()})+'\\n')
t=socket.socket();t.bind(('0.0.0.0',18080));t.listen()
u=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);u.bind((sys.argv[1],18081))
def tcp():
 while True:
  c,_=t.accept();data=c.recv(4096);record(data);c.sendall(b'HTTP/1.0 200 OK\\r\\nContent-Length: 2\\r\\n\\r\\nOK');c.close()
def udp():
 while True:
  data,addr=u.recvfrom(4096);record(data);u.sendto(data,addr)
(root/'pid').write_text(str(os.getpid()))
threading.Thread(target=tcp,daemon=True).start();threading.Thread(target=udp,daemon=True).start()
s=socket.socket(socket.AF_PACKET,socket.SOCK_RAW,socket.htons(3))
while True:record(s.recv(65535))
`;
export function startListeners(destinations: string[], nodeIp: string) {
	save(
		"network-node-rules-before.txt",
		docker(["exec", node, "iptables-save"]),
	);
	docker(["exec", node, "mkdir", "-m", "700", directory]);
	created = true;
	try {
		docker(["exec", "-d", node, "python3", "-u", "-c", listenerScript, nodeIp]);
		docker([
			"exec",
			node,
			"sh",
			"-c",
			`for n in 1 2 3 4 5; do test -s ${directory}/pid && exit 0; sleep .2; done; exit 1`,
		]);
		for (const ip of destinations)
			for (const protocol of ["tcp", "udp"]) {
				const port = protocol === "tcp" ? "18080" : "18081";
				const rule = [
					"PREROUTING",
					"-d",
					ip,
					"-p",
					protocol,
					"--dport",
					port,
					"-m",
					"comment",
					"--comment",
					marker,
					"-j",
					"DNAT",
					"--to-destination",
					`${nodeIp}:${port}`,
				];
				docker(["exec", node, "iptables", "-t", "nat", "-I", ...rule]);
				rules.push(rule);
			}
	} catch (err) {
		stopListeners();
		throw err;
	}
}
export function packets() {
	return docker(["exec", node, "cat", `${directory}/packets.jsonl`]);
}
export function stopListeners() {
	for (const rule of rules.reverse())
		docker(["exec", node, "iptables", "-t", "nat", "-D", ...rule]);
	rules.length = 0;
	if (created) {
		const pid = docker([
			"exec",
			node,
			"sh",
			"-c",
			`if test -s ${directory}/pid; then cat ${directory}/pid; fi`,
		]).trim();
		if (pid) {
			assert(/^\d+$/.test(pid));
			const command = docker([
				"exec",
				node,
				"sh",
				"-c",
				`tr '\\000' ' ' < /proc/${pid}/cmdline`,
			]);
			assert(command.includes(directory));
			docker(["exec", node, "kill", pid]);
		}
		docker(["exec", node, "rm", "-r", directory]);
		created = false;
	}
	const after = docker(["exec", node, "iptables-save"]);
	assert(!after.includes(marker));
	save("network-node-cleanup.json", {
		marker,
		directory,
		rulesRemoved: true,
		listenerRemoved: true,
	});
	save("network-node-rules-after.txt", after);
}
