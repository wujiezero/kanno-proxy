'use strict';
'require baseclass';
'require uci';

var CONF  = 'tomfly';
var TOMFLY = '/usr/bin/tomfly';
var UCI   = '/sbin/uci';
var LOG   = '/var/log/tomfly.log';
var SCHEME = /^(vless|vmess|trojan|ss|hy2|hysteria2|tuic|naive\+https|anytls):\/\//;
var LOGLEVELS = { silent: 1, error: 1, warning: 1, info: 1, debug: 1 };

/* UI mirror of /usr/lib/tomfly/capabilities.sh (source of truth is the shell).
   Used only to warn the user proactively; the kernel/config validation is the
   authority that actually drops incompatible nodes. */
var KERNEL_CAPS = {
	mihomo:  ['vless', 'vmess', 'trojan', 'ss', 'hysteria2', 'hy2', 'tuic', 'anytls'],
	singbox: ['vless', 'vmess', 'trojan', 'ss', 'hysteria2', 'hy2', 'tuic', 'anytls']
};
function nodeIncompat(kernel, type, security) {
	var k = (kernel === 'singbox') ? 'singbox' : 'mihomo';
	if (KERNEL_CAPS[k].indexOf(type) < 0) return k + ' has no "' + (type || '?') + '" outbound';
	if (k === 'mihomo' && type === 'anytls' && security === 'reality')
		return 'mihomo does not support anytls+reality';
	return '';
}
var _rpcId = 0;

/* Direct ubus HTTP call — bypasses LuCI RPC batching which deadlocks in load() */
function exec(cmd, args) {
	var payload = JSON.stringify({
		jsonrpc: '2.0', id: ++_rpcId, method: 'call',
		params: [L.env.sessionid, 'file', 'exec',
		         { command: cmd, params: args || [] }]
	});
	return L.Request.post('/ubus/', payload, { 'Content-Type': 'application/json' }).then(function (resp) {
		var j = resp.json();
		if (j && j.result && j.result[0] === 0 && j.result[1])
			return j.result[1];
		return { code: -1, stdout: '', stderr: 'ubus error' };
	}).catch(function (e) {
		return { code: -1, stdout: '', stderr: String(e && e.message || e) };
	});
}
function out(cmd, args) {
	return exec(cmd, args).then(function (r) { return (r.stdout || '').replace(/\s+$/, ''); });
}
function uciBatch(cmds) {
	return cmds.reduce(function (ch, a) {
		return ch.then(function () { return exec(UCI, a); });
	}, Promise.resolve());
}
function loadConf() { return uci.load(CONF).catch(function () {}); }
function refresh() { uci.unload(CONF); return loadConf(); }

/* ── Status ─────────────────────────────────────────────── */
function getStatus() {
	return loadConf().then(function () {
		var kernel = uci.get(CONF, 'global', 'kernel') || 'mihomo';
		var mode   = uci.get(CONF, 'global', 'mode') || 'rule';
		return out(TOMFLY, ['status']).then(function (st) {
			var running = /running/i.test(st) && !/not\s*running|stopped/i.test(st);
			var pVer = running
				? out(kernel === 'mihomo' ? '/usr/bin/mihomo' : '/usr/bin/sing-box',
					[kernel === 'mihomo' ? '-v' : 'version'])
				: Promise.resolve('');
			var pConn = running
				? out('/usr/bin/curl', ['-sf', '--max-time', '2', 'http://127.0.0.1:9090/connections'])
				: Promise.resolve('');
			return Promise.all([pVer, pConn]).then(function (a) {
				var conns = 0;
				try { var o = JSON.parse(a[1]); if (o && o.connections) conns = o.connections.length; } catch (e) {}
				return {
					running: running, kernel: kernel, mode: mode,
					version: (a[0] || '').split('\n')[0], connections: conns
				};
			});
		});
	});
}

/* ── Nodes ──────────────────────────────────────────────── */
function getNodes() {
	return loadConf().then(function () {
		var kernel = uci.get(CONF, 'global', 'kernel') || 'mihomo';
		return { kernel: kernel, nodes: uci.sections(CONF, 'proxy').map(function (s) {
			var type = s.type || '', security = s.security || 'none';
			return {
				id:        s['.name'].replace(/^proxy_/, ''),
				name:      s.name || '',
				type:      type,
				server:    s.server || '',
				port:      s.port || '',
				enabled:   s.enabled !== '0',
				security:  security,
				transport: s.transport || 'tcp',
				order:     parseInt(s.order, 10) || 0,
				incompat:  nodeIncompat(kernel, type, security)
			};
		}).sort(function (a, b) { return a.order - b.order; }) };
	});
}

function addNode(p) {
	var uri = (p.uri || '').trim();
	if (!SCHEME.test(uri))
		return Promise.resolve({ ok: false, error: 'unsupported URI scheme' });
	return exec(TOMFLY, ['add', uri]).then(function (r) {
		var m = (r.stdout || '').match(/[0-9a-f]{8}/);
		if (r.code === 0 && m) {
			return refresh().then(function () {
				return { ok: true, id: m[0], name: uci.get(CONF, 'proxy_' + m[0], 'name') || '' };
			});
		}
		return { ok: false, error: (r.stderr || r.stdout || 'parse failed').split('\n')[0] };
	});
}

function delNode(p) {
	if (!/^[0-9a-f]+$/.test(p.id || ''))
		return Promise.resolve({ ok: false, error: 'invalid id' });
	return uciBatch([['delete', CONF + '.proxy_' + p.id], ['commit', CONF]])
		.then(refresh).then(function () { return { ok: true }; });
}

function toggleNode(p) {
	if (!/^[0-9a-f]+$/.test(p.id || ''))
		return Promise.resolve({ ok: false, error: 'invalid id' });
	return uciBatch([
		['set', CONF + '.proxy_' + p.id + '.enabled=' + (p.enabled ? '1' : '0')],
		['commit', CONF]
	]).then(refresh).then(function () { return { ok: true }; });
}

function testNode(p) {
	if (!/^[0-9a-f]+$/.test(p.id || ''))
		return Promise.resolve({ ok: false, error: 'invalid id' });
	return out(TOMFLY, ['test', p.id]).then(function (s) {
		var m = s.match(/(\d+)\s*ms/);
		return { ok: !/timeout/i.test(s) && !!m, latency: m ? parseInt(m[1], 10) : null, result: s };
	});
}

function testAll() {
	return getNodes().then(function (r) {
		var results = [];
		return (r.nodes || []).reduce(function (ch, n) {
			return ch.then(function () {
				return out(TOMFLY, ['test', n.id]).then(function (s) {
					var m = s.match(/(\d+)\s*ms/);
					results.push({ id: n.id, ok: !/timeout/i.test(s) && !!m, latency: m ? parseInt(m[1], 10) : null });
				});
			});
		}, Promise.resolve()).then(function () { return { results: results }; });
	});
}

/* ── Service control ────────────────────────────────────── */
function bg(cmd) { return exec('/bin/sh', ['-c', cmd]).then(function () { return { ok: true }; }); }
function restart() { return bg(TOMFLY + ' restart >/tmp/tomfly-restart.log 2>&1 &'); }
function stopSvc() { return exec(TOMFLY, ['stop']).then(function () { return { ok: true }; }); }

/* ── Groups ─────────────────────────────────────────────── */
function getGroups() {
	return loadConf().then(function () {
		return { groups: uci.sections(CONF, 'proxygroup').map(function (s) {
			return {
				id:        s['.name'].replace(/^group_/, ''),
				name:      s.name || '',
				type:      s.type || 'url-test',
				proxies:   L.toArray(s.proxies),
				url:       s.url || 'http://www.gstatic.com/generate_204',
				interval:  parseInt(s.interval, 10) || 300,
				tolerance: parseInt(s.tolerance, 10) || 50
			};
		}) };
	});
}

function saveGroups(p) {
	var groups = p.groups || [];
	return loadConf().then(function () {
		var cmds = uci.sections(CONF, 'proxygroup').map(function (s) {
			return ['delete', CONF + '.' + s['.name']];
		});
		groups.forEach(function (g, gi) {
			var sec = CONF + '.group_g' + gi;
			cmds.push(['set', sec + '=proxygroup']);
			cmds.push(['set', sec + '.name=' + (g.name || '')]);
			cmds.push(['set', sec + '.type=' + (g.type || 'url-test')]);
			cmds.push(['set', sec + '.url=' + (g.url || 'http://www.gstatic.com/generate_204')]);
			cmds.push(['set', sec + '.interval=' + (parseInt(g.interval, 10) || 300)]);
			cmds.push(['set', sec + '.tolerance=' + (parseInt(g.tolerance, 10) || 50)]);
			L.toArray(g.proxies).forEach(function (pr) { cmds.push(['add_list', sec + '.proxies=' + pr]); });
		});
		cmds.push(['commit', CONF]);
		return uciBatch(cmds);
	}).then(refresh).then(function () { return { ok: true }; })
	  .catch(function (e) { return { ok: false, error: String(e && e.message || e) }; });
}

/* ── Rules ──────────────────────────────────────────────── */
function parseLines(t) {
	return (t || '').split('\n').map(function (l) { return l.trim(); })
		.filter(function (l) { return l && l[0] !== '#'; });
}
function getRules() {
	return loadConf().then(function () {
		return Promise.all([
			out('/bin/sh', ['-c', 'cat /etc/tomfly/rules/force_proxy.txt 2>/dev/null']),
			out('/bin/sh', ['-c', 'cat /etc/tomfly/rules/force_direct.txt 2>/dev/null'])
		]).then(function (f) {
			return {
				geosite_cn:     uci.get(CONF, 'rules', 'geosite_cn') || 'DIRECT',
				geoip_cn:       uci.get(CONF, 'rules', 'geoip_cn') || 'DIRECT',
				default_policy: uci.get(CONF, 'rules', 'default_policy') || 'PROXY',
				force_proxy:    parseLines(f[0]),
				force_direct:   parseLines(f[1])
			};
		});
	});
}
function saveRules(p) {
	var fp = '# TomFly custom rules\n' + L.toArray(p.force_proxy).join('\n') + '\n';
	var fd = '# TomFly custom rules\n' + L.toArray(p.force_direct).join('\n') + '\n';
	return uciBatch([
		['set', CONF + '.rules=rules'],
		['set', CONF + '.rules.geosite_cn=' + (p.geosite_cn || 'DIRECT')],
		['set', CONF + '.rules.geoip_cn=' + (p.geoip_cn || 'DIRECT')],
		['set', CONF + '.rules.default_policy=' + (p.default_policy || 'PROXY')],
		['commit', CONF]
	]).then(function () {
		// Write rule files via base64 to avoid heredoc injection
		var b64Proxy  = btoa(fp);
		var b64Direct = btoa(fd);
		return Promise.all([
			exec('/bin/sh', ['-c', 'echo "' + b64Proxy  + '" | base64 -d > /etc/tomfly/rules/force_proxy.txt']),
			exec('/bin/sh', ['-c', 'echo "' + b64Direct + '" | base64 -d > /etc/tomfly/rules/force_direct.txt'])
		]);
	}).then(refresh).then(function () { return { ok: true }; })
	  .catch(function (e) { return { ok: false, error: String(e && e.message || e) }; });
}

/* ── DNS ────────────────────────────────────────────────── */
function getDns() {
	return loadConf().then(function () {
		var dom = L.toArray(uci.get(CONF, 'dns', 'domestic_dns'));
		var frn = L.toArray(uci.get(CONF, 'dns', 'foreign_dns'));
		return {
			enabled:      uci.get(CONF, 'dns', 'enabled') !== '0',
			mode:         uci.get(CONF, 'dns', 'mode') || 'fake-ip',
			listen_port:  parseInt(uci.get(CONF, 'dns', 'listen_port'), 10) || 1053,
			domestic_dns: dom.length ? dom : ['114.114.114.114', '223.5.5.5'],
			foreign_dns:  frn.length ? frn : ['8.8.8.8', '1.1.1.1']
		};
	});
}
function saveDns(p) {
	var cmds = [
		['set', CONF + '.dns=dns'],
		['set', CONF + '.dns.enabled=' + (p.enabled === false ? '0' : '1')],
		['set', CONF + '.dns.mode=' + (p.mode || 'fake-ip')],
		['set', CONF + '.dns.listen_port=' + (parseInt(p.listen_port, 10) || 1053)],
		['delete', CONF + '.dns.domestic_dns'],
		['delete', CONF + '.dns.foreign_dns']
	];
	L.toArray(p.domestic_dns).forEach(function (v) { cmds.push(['add_list', CONF + '.dns.domestic_dns=' + v]); });
	L.toArray(p.foreign_dns).forEach(function (v) { cmds.push(['add_list', CONF + '.dns.foreign_dns=' + v]); });
	cmds.push(['commit', CONF]);
	return uciBatch(cmds).then(refresh).then(function () { return { ok: true }; })
		.catch(function (e) { return { ok: false, error: String(e && e.message || e) }; });
}

/* ── Global / kernel settings ───────────────────────────── */
function getGlobal() {
	return loadConf().then(function () {
		return {
			enabled:   uci.get(CONF, 'global', 'enabled') !== '0',
			kernel:    uci.get(CONF, 'global', 'kernel') || 'mihomo',
			mode:      uci.get(CONF, 'global', 'mode') || 'rule',
			log_level: uci.get(CONF, 'global', 'log_level') || 'info',
			ipv6:      uci.get(CONF, 'global', 'ipv6') === '1',
			tun:       uci.get(CONF, 'global', 'tun') !== '0',
			autostart: uci.get(CONF, 'global', 'autostart') === '1',
			traffic_stats: uci.get(CONF, 'global', 'traffic_stats') !== '0'
		};
	});
}
function saveGlobal(p) {
	var kernel = (p.kernel === 'mihomo' || p.kernel === 'singbox') ? p.kernel : 'mihomo';
	var mode   = ({ rule: 1, global: 1, direct: 1 }[p.mode]) ? p.mode : 'rule';
	var level  = LOGLEVELS[p.log_level] ? p.log_level : 'info';
	return uciBatch([
		['set', CONF + '.global=global'],
		['set', CONF + '.global.enabled=' + (p.enabled === false ? '0' : '1')],
		['set', CONF + '.global.kernel=' + kernel],
		['set', CONF + '.global.mode=' + mode],
		['set', CONF + '.global.log_level=' + level],
		['set', CONF + '.global.ipv6=' + (p.ipv6 ? '1' : '0')],
		['set', CONF + '.global.tun=' + (p.tun !== false ? '1' : '0')],
		['set', CONF + '.global.autostart=' + (p.autostart ? '1' : '0')],
		['set', CONF + '.global.traffic_stats=' + (p.traffic_stats === false ? '0' : '1')],
		['commit', CONF]
	]).then(refresh).then(function () { return { ok: true }; })
	  .catch(function (e) { return { ok: false, error: String(e && e.message || e) }; });
}

/* ── Kernels / geodata ──────────────────────────────────── */
function kernelVer(bin, arg) {
	return exec(bin, [arg]).then(function (r) {
		if (r.code !== 0) return { installed: false, version: '' };
		return { installed: true, version: (r.stdout || '').split('\n')[0], path: bin };
	});
}
function getKernels() {
	return Promise.all([
		kernelVer('/usr/bin/mihomo', '-v'),
		kernelVer('/usr/bin/sing-box', 'version'),
		out('/bin/sh', ['-c',
			'cat /etc/tomfly/geodata/version 2>/dev/null;' +
			'echo "|";test -f /etc/tomfly/geodata/geoip.dat && echo yes || echo no;' +
			'echo "|";test -f /etc/tomfly/geodata/geosite.dat && echo yes || echo no;' +
			'echo "|";test -f /etc/tomfly/geodata/geoip-cn.srs && echo yes || echo no;' +
			'echo "|";test -f /etc/tomfly/geodata/geosite-cn.srs && echo yes || echo no'
		]).then(function (t) {
			var a = (t || '').split('|');
			return {
				version: (a[0] || '').trim(),
				geoip: (a[1] || 'no').trim(),
				geosite: (a[2] || 'no').trim(),
				srs_geoip: (a[3] || 'no').trim(),
				srs_geosite: (a[4] || 'no').trim()
			};
		})
	]).then(function (a) { return { mihomo: a[0], singbox: a[1], geodata: a[2] }; });
}
function updateKernel(p) {
	var t = p.target;
	if (!/^[a-z][a-z0-9_]*$/.test(t || ''))
		return Promise.resolve({ ok: false, error: 'invalid target' });
	return bg(TOMFLY + ' update ' + t + ' >/tmp/tomfly-update.log 2>&1 &').then(function () {
		return { ok: true, message: 'Update started in background — check the Logs tab' };
	});
}

/* ── Logs ───────────────────────────────────────────────── */
function getLogs(p) {
	var n = parseInt(p.lines, 10) || 100;
	if (n > 500) n = 500;
	return out('/bin/sh', ['-c', 'tail -n ' + n + ' ' + LOG + ' 2>/dev/null']).then(function (txt) {
		var lines = (txt || '').split('\n').filter(function (l) { return l.length; });
		return { lines: lines };
	});
}

/* ── Traffic (mihomo/sing-box Clash API) ──────────── */
function parseMemoryBytes(connMem, raw) {
	if (connMem != null && connMem > 0) return connMem;
	if (!raw) return 0;
	var lines = (raw || '').split('\n');
	var max = 0;
	var i, line, m, v;
	for (i = 0; i < lines.length; i++) {
		line = lines[i].trim();
		if (!line) continue;
		try {
			m = JSON.parse(line);
			v = m.inuse != null ? m.inuse : (m.memory != null ? m.memory : 0);
			if (v > max) max = v;
		} catch (e) {}
	}
	if (max > 0) return max;
	try {
		m = JSON.parse((raw || '').trim());
		if (typeof m === 'number') return m;
		if (m.inuse != null) return m.inuse * 1024;
		if (m.memory != null) return m.memory;
	} catch (e) {}
	return 0;
}
function getTraffic() {
	return Promise.all([
		out('/usr/bin/curl', ['-sf', '--max-time', '2', 'http://127.0.0.1:9090/connections']),
		out('/usr/bin/curl', ['-sf', '--max-time', '2', 'http://127.0.0.1:9090/proxies/PROXY']),
		out('/usr/bin/curl', ['-sf', '--max-time', '3', 'http://127.0.0.1:9090/memory'])
	]).then(function (a) {
		var traffic = { up: 0, down: 0, conns: 0, mem: 0, activeNode: '' };
		var connMem;
		try {
			var o = JSON.parse(a[0]);
			traffic.up = o.uploadTotal || 0;
			traffic.down = o.downloadTotal || 0;
			traffic.conns = Array.isArray(o.connections) ? o.connections.length : 0;
			if (o.memory != null) connMem = o.memory;
		} catch (e) {}
		try {
			var p = JSON.parse(a[1]);
			traffic.activeNode = p.now || '';
		} catch (e) {}
		traffic.mem = parseMemoryBytes(connMem, a[2]);
		return traffic;
	});
}
function getConnections() {
	return out('/usr/bin/curl', ['-sf', '--max-time', '3', 'http://127.0.0.1:9090/connections']).then(function (s) {
		try {
			var o = JSON.parse(s);
			return {
				connections: Array.isArray(o.connections) ? o.connections : [],
				uploadTotal: o.uploadTotal || 0,
				downloadTotal: o.downloadTotal || 0
			};
		} catch (e) {
			return { connections: [], uploadTotal: 0, downloadTotal: 0 };
		}
	});
}

/* ── Access check ──────────────────────────────── */
function checkAccess() {
	var sites = [
		{ name: 'Baidu', url: 'https://www.baidu.com' },
		{ name: 'Google', url: 'https://www.google.com/generate_204' },
		{ name: 'YouTube', url: 'https://www.youtube.com' }
	];
	var results = [];
	return sites.reduce(function (ch, site) {
		return ch.then(function () {
			return exec('/usr/bin/curl', ['-o', '/dev/null', '-s', '-w', '%{time_total}', '--max-time', '3', site.url])
				.then(function (r) {
					var t = parseFloat((r.stdout || '').trim());
					results.push({
						name: site.name,
						ok: r.code === 0 && t > 0,
						latency: r.code === 0 && t > 0 ? Math.round(t * 1000) : null
					});
				});
		});
	}, Promise.resolve()).then(function () { return { sites: results }; });
}

/* ── Quick mode change ─────────────────────────── */
function setMode(p) {
	var cmds = [];
	if (p.mode && { rule: 1, global: 1, direct: 1 }[p.mode])
		cmds.push(['set', CONF + '.global.mode=' + p.mode]);
	if (p.dns_mode && (p.dns_mode === 'fake-ip' || p.dns_mode === 'redir-host')) {
		cmds.push(['set', CONF + '.dns=dns']);
		cmds.push(['set', CONF + '.dns.mode=' + p.dns_mode]);
	}
	if (p.tun !== undefined || p.autostart !== undefined || p.traffic_stats !== undefined) {
		return loadConf().then(function () {
			var kernel = uci.get(CONF, 'global', 'kernel') || 'mihomo';
			var allCmds = cmds.slice();
			if (p.tun !== undefined && kernel !== 'singbox') {
				allCmds.push(['set', CONF + '.global=global']);
				allCmds.push(['set', CONF + '.global.tun=' + (p.tun ? '1' : '0')]);
			}
			if (p.autostart !== undefined) {
				allCmds.push(['set', CONF + '.global=global']);
				allCmds.push(['set', CONF + '.global.autostart=' + (p.autostart ? '1' : '0')]);
			}
			if (p.traffic_stats !== undefined) {
				allCmds.push(['set', CONF + '.global=global']);
				allCmds.push(['set', CONF + '.global.traffic_stats=' + (p.traffic_stats === false ? '0' : '1')]);
			}
			if (allCmds.length === 0) return Promise.resolve({ ok: true });
			allCmds.push(['commit', CONF]);
			return uciBatch(allCmds);
		}).then(refresh).then(function () { return { ok: true }; });
	}
	if (cmds.length === 0) return Promise.resolve({ ok: true });
	cmds.push(['commit', CONF]);
	return uciBatch(cmds).then(refresh).then(function () { return { ok: true }; });
}

/* ── Clear log ─────────────────────────────────── */
function clearLog() {
	return exec(TOMFLY, ['clear_log']).then(function () { return { ok: true }; });
}

/* ── Per-site access check ────────────────────── */
function checkSite(p) {
	var url = (p.url || '').trim();
	var name = (p.name || url).trim();
	if (!url) return Promise.resolve({ ok: false, error: 'no url' });
	return exec('/usr/bin/curl', ['-o', '/dev/null', '-s', '-w', '%{time_total}', '--max-time', '5', url])
		.then(function (r) {
			var t = parseFloat((r.stdout || '').trim());
			return {
				name: name,
				ok: r.code === 0 && t > 0,
				latency: r.code === 0 && t > 0 ? Math.round(t * 1000) : null
			};
		});
}

/* ── Edit node fields ─────────────────────────── */
function editNode(p) {
	if (!/^[0-9a-f]+$/.test(p.id || ''))
		return Promise.resolve({ ok: false, error: 'invalid id' });
	var sec = CONF + '.proxy_' + p.id;
	var allowed = { name: 1, server: 1, port: 1, uuid: 1, password: 1,
		security: 1, sni: 1, fp: 1, pbk: 1, sid: 1, flow: 1,
		transport: 1, transport_host: 1, transport_path: 1, transport_svcname: 1,
		method: 1, insecure: 1, obfs: 1, obfs_password: 1, alpn: 1 };
	var cmds = [];
	Object.keys(p.fields || {}).forEach(function (k) {
		if (allowed[k]) cmds.push(['set', sec + '.' + k + '=' + p.fields[k]]);
	});
	if (cmds.length === 0) return Promise.resolve({ ok: true });
	cmds.push(['commit', CONF]);
	return uciBatch(cmds).then(refresh).then(function () { return { ok: true }; });
}

function getNode(p) {
	if (!/^[0-9a-f]+$/.test(p.id || ''))
		return Promise.resolve({ ok: false, error: 'invalid id' });
	return loadConf().then(function () {
		var sec = 'proxy_' + p.id;
		var obj = {};
		var keys = ['name', 'type', 'server', 'port', 'uuid', 'password',
			'security', 'sni', 'fp', 'pbk', 'sid', 'flow',
			'transport', 'transport_host', 'transport_path', 'transport_svcname',
			'method', 'insecure', 'obfs', 'obfs_password', 'alpn', 'enabled'];
		keys.forEach(function (k) {
			var v = uci.get(CONF, sec, k);
			if (v !== undefined && v !== null) obj[k] = v;
		});
		obj.id = p.id;
		return obj;
	});
}

/* ── Kernel / geodata upload install (file already in /tmp via cgi-io) */
function installUpload(p) {
	var target = p.target;
	var src = '/tmp/tomfly-upload.bin';
	var geodir = '/etc/tomfly/geodata';

	if (target === 'geodata' || target === 'geodata_mihomo' || target === 'geodata_singbox') {
		var kind = p.kind || 'bundle';
		var valid = ['bundle', 'geoip', 'geosite', 'geoip_srs', 'geosite_srs',
			'bundle_mihomo', 'bundle_singbox'];
		if (valid.indexOf(kind) < 0)
			return Promise.resolve({ ok: false, error: 'invalid geodata kind' });
		if (target === 'geodata_mihomo' && kind === 'bundle')
			kind = 'bundle_mihomo';
		if (target === 'geodata_singbox' && kind === 'bundle')
			kind = 'bundle_singbox';

		// Use base64 to transfer the upload path securely, avoiding shell injection.
		// The CGI uploader drops the file at a known path; we verify it exists first.
		var cmd = 'src=' + src + '; dir=' + geodir + '; '
			+ '[ -f "$src" ] || { echo "upload file missing" >&2; exit 1; }; '
			+ 'T=/tmp/tomfly-gd-$$; '
			+ 'mkdir -p "$dir" "$T"; ok=0; '
			+ '_one() { local name="$1"; local dest="$dir/$name"; '
			+ '  if gzip -dc "$src" > "$dest" 2>/dev/null; then ok=$((ok+1)); return 0; fi; '
			+ '  cp "$src" "$dest" && ok=$((ok+1)); }; '
			+ '_bundle() { local names="$1"; local name f; '
			+ '  if tar -xzf "$src" -C "$T" 2>/dev/null || tar -xf "$src" -C "$T" 2>/dev/null; then '
			+ '    for name in $names; do '
			+ '      f=$(find "$T" -type f -name "$name" 2>/dev/null | head -1); '
			+ '      [ -n "$f" ] && cp "$f" "$dir/$name" && ok=$((ok+1)); '
			+ '    done; '
			+ '  fi; }; '
			+ 'case "' + kind + '" in '
			+ 'geoip) _one geoip.dat ;; '
			+ 'geosite) _one geosite.dat ;; '
			+ 'geoip_srs) _one geoip-cn.srs ;; '
			+ 'geosite_srs) _one geosite-cn.srs ;; '
			+ 'bundle_mihomo) _bundle "geoip.dat geosite.dat" ;; '
			+ 'bundle_singbox) _bundle "geoip-cn.srs geosite-cn.srs" ;; '
			+ '*) _bundle "geoip.dat geosite.dat geoip-cn.srs geosite-cn.srs" ;; '
			+ 'esac; '
			+ 'rm -rf "$T" "$src"; '
			+ 'if [ "$ok" -gt 0 ]; then date "+%Y-%m-%d" > "$dir/version"; exit 0; fi; '
			+ 'echo "no geodata files found in upload" >&2; exit 1';
		return exec('/bin/sh', ['-c', cmd]).then(function (r) {
			if (r.code === 0) return { ok: true };
			return { ok: false, error: (r.stderr || r.stdout || 'install failed').split('\n')[0] };
		});
	}

	if (target !== 'mihomo' && target !== 'singbox')
		return Promise.resolve({ ok: false, error: 'invalid target' });

	// Validate destination path against a whitelist
	var dest = target === 'mihomo' ? '/usr/bin/mihomo' : '/usr/bin/sing-box';
	var bin = target === 'mihomo' ? 'mihomo' : 'sing-box';
	var verarg = target === 'mihomo' ? '-v' : 'version';
	var cmd = 'src=' + src + '; dest=' + dest + '; bin=' + bin + '; verarg=' + verarg + '; '
		+ '[ -f "$src" ] || { echo "upload file missing" >&2; exit 1; }; '
		+ 'T=/tmp/tomfly-ext-$$; U=/tmp/tomfly-ungz-$$; old="${dest}.tomfly-old"; mkdir -p "$T"; '
		+ '[ -f "$dest" ] && cp "$dest" "$old" 2>/dev/null || rm -f "$old"; '
		+ '_install() { F="$1"; [ -n "$F" ] && [ -f "$F" ] || { echo "no binary found in upload" >&2; exit 1; }; '
		+ '  cp "$F" "$dest" && chmod +x "$dest" || { echo "install copy failed" >&2; exit 1; }; '
		+ '  "$dest" "$verarg" >/dev/null 2>&1 && { rm -f "$old"; return 0; }; '
		+ '  rm -f "$dest"; [ -f "$old" ] && mv "$old" "$dest"; '
		+ '  echo "uploaded binary not executable on this platform" >&2; exit 1; }; '
		+ 'if tar -xzf "$src" -C "$T" 2>/dev/null; then '
		+ '  F=$(find "$T" -type f -name "$bin" | head -1); '
		+ '  [ -n "$F" ] || F=$(find "$T" -type f ! -name "*.sha256" ! -name "LICENSE*" ! -name "README*" ! -name "*.md" | head -1); '
		+ '  _install "$F"; '
		+ 'elif gzip -d -c "$src" > "$U" 2>/dev/null; then '
		+ '  _install "$U"; '
		+ 'else '
		+ '  _install "$src"; '
		+ 'fi; rm -rf "$src" "$T" "$U"';
	return exec('/bin/sh', ['-c', cmd]).then(function (r) {
		if (r.code === 0) return { ok: true };
		return { ok: false, error: (r.stderr || 'install failed').split('\n')[0] };
	});
}

/* ── Active-node selection (mihomo "PROXY" selector group) ─────── */
function getProxyOptions() {
	return out('/usr/bin/curl', ['-sf', '--max-time', '2', 'http://127.0.0.1:9090/proxies/PROXY']).then(function (s) {
		try { var o = JSON.parse(s); return { now: o.now || '', all: o.all || [] }; }
		catch (e) { return { now: '', all: [] }; }
	});
}
function selectNode(p) {
	var name = (p.name || '').trim();
	if (!name) return Promise.resolve({ ok: false, error: 'no name' });
	return exec('/usr/bin/curl', ['-s', '-X', 'PUT', '--max-time', '3',
		'http://127.0.0.1:9090/proxies/PROXY', '-d', JSON.stringify({ name: name })])
		.then(function (r) { return { ok: r.code === 0 }; });
}

/* ── Monthly per-node traffic ─────────────────────── */
function getNodeTraffic() {
	return out('/usr/bin/tomfly', ['traffic']).then(function (txt) {
		try {
			var o = JSON.parse(txt);
			return { month: o.month || '', nodes: o.nodes || {}, running: o._running };
		} catch (e) {
			return { month: '', nodes: {}, running: false };
		}
	});
}

/* ── Node reorder ────────────────────────────────── */
function reorderNode(p) {
	if (!/^[0-9a-f]+$/.test(p.id || ''))
		return Promise.resolve({ ok: false, error: 'invalid id' });
	if (p.dir !== 'up' && p.dir !== 'down')
		return Promise.resolve({ ok: false, error: 'invalid direction' });
	return out(TOMFLY, ['reorder', p.id, p.dir]).then(function (txt) {
		if (/moved|already at/i.test(txt))
			return refresh().then(function () { return { ok: true, message: txt }; });
		return { ok: false, error: txt };
	});
}

var DISPATCH = {
	get_status: getStatus, get_nodes: getNodes, add_node: addNode, del_node: delNode,
	toggle_node: toggleNode, test_node: testNode, test_all_nodes: testAll,
	restart: restart, stop: stopSvc, get_groups: getGroups, save_groups: saveGroups,
	get_rules: getRules, save_rules: saveRules, get_dns: getDns, save_dns: saveDns,
	get_global: getGlobal, save_global: saveGlobal, get_kernels: getKernels,
	update_kernel: updateKernel, get_logs: getLogs, clear_log: clearLog,
	get_traffic: getTraffic, get_connections: getConnections, check_access: checkAccess, check_site: checkSite,
	set_mode: setMode, install_upload: installUpload,
	get_node: getNode, edit_node: editNode,
	get_proxy_options: getProxyOptions, select_node: selectNode,
	get_node_traffic: getNodeTraffic,
	reorder_node: reorderNode
};

return baseclass.extend({
	call: function (method, params) {
		var fn = DISPATCH[method];
		if (!fn) return Promise.reject(new Error('unknown method: ' + method));
		try { return Promise.resolve(fn(params || {})); }
		catch (e) { return Promise.reject(e); }
	}
});
