'use strict';
'require baseclass';
'require fs';
'require uci';

/*
 * Native data layer for KannoProxy.
 *
 * ImmortalWrt 25.12 ships the JavaScript-only LuCI client with NO Lua
 * runtime, so the old /cgi-bin/kanno + luci.rpc.kanno backend cannot run.
 * Everything here is implemented with core LuCI JS modules instead:
 *   - 'require uci'  → read/declare config (writes go through the uci CLI)
 *   - 'require fs'   → fs.exec() to drive the /usr/bin/kanno shell CLI
 *
 * The public surface is unchanged: api.call('<method>', params) → Promise,
 * so the views keep working without modification.
 */

var CONF  = 'kanno';
var KANNO = '/usr/bin/kanno';
var UCI   = '/sbin/uci';
var LOG   = '/var/log/kanno.log';
var SCHEME = /^(vless|vmess|trojan|ss|hy2|hysteria2|tuic|naive\+https):\/\//;
var LOGLEVELS = { silent: 1, error: 1, warning: 1, info: 1, debug: 1 };

/* fs.exec that never rejects — returns {code, stdout, stderr} */
function exec(cmd, args) {
	return fs.exec(cmd, args).catch(function (e) {
		return { code: -1, stdout: '', stderr: String(e && e.message || e) };
	});
}
/* exec → trimmed stdout string */
function out(cmd, args) {
	return exec(cmd, args).then(function (r) { return (r.stdout || '').replace(/\s+$/, ''); });
}
/* run a sequence of `uci` CLI invocations (arg arrays); args are NOT shell-
 * interpreted (fs.exec spawns directly) so user values are injection-safe */
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
		return out(KANNO, ['status']).then(function (st) {
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
		return { nodes: uci.sections(CONF, 'proxy').map(function (s) {
			return {
				id:        s['.name'].replace(/^proxy_/, ''),
				name:      s.name || '',
				type:      s.type || '',
				server:    s.server || '',
				port:      s.port || '',
				enabled:   s.enabled !== '0',
				security:  s.security || 'none',
				transport: s.transport || 'tcp'
			};
		}) };
	});
}

function addNode(p) {
	var uri = (p.uri || '').trim();
	if (!SCHEME.test(uri))
		return Promise.resolve({ ok: false, error: 'unsupported URI scheme' });
	return exec(KANNO, ['add', uri]).then(function (r) {
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
	return out(KANNO, ['test', p.id]).then(function (s) {
		var m = s.match(/(\d+)\s*ms/);
		return { ok: !/timeout/i.test(s) && !!m, latency: m ? parseInt(m[1], 10) : null, result: s };
	});
}

function testAll() {
	return getNodes().then(function (r) {
		var results = [];
		return (r.nodes || []).reduce(function (ch, n) {
			return ch.then(function () {
				return out(KANNO, ['test', n.id]).then(function (s) {
					var m = s.match(/(\d+)\s*ms/);
					results.push({ id: n.id, ok: !/timeout/i.test(s) && !!m, latency: m ? parseInt(m[1], 10) : null });
				});
			});
		}, Promise.resolve()).then(function () { return { results: results }; });
	});
}

/* ── Service control ────────────────────────────────────── */
function bg(cmd) { return exec('/bin/sh', ['-c', cmd]).then(function () { return { ok: true }; }); }
function restart() { return bg(KANNO + ' restart >/tmp/kanno-restart.log 2>&1 &'); }
function stopSvc() { return exec(KANNO, ['stop']).then(function () { return { ok: true }; }); }

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
			fs.read('/etc/kanno/rules/force_proxy.txt').catch(function () { return ''; }),
			fs.read('/etc/kanno/rules/force_direct.txt').catch(function () { return ''; })
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
	var fp = '# KannoProxy custom rules\n' + L.toArray(p.force_proxy).join('\n') + '\n';
	var fd = '# KannoProxy custom rules\n' + L.toArray(p.force_direct).join('\n') + '\n';
	return uciBatch([
		['set', CONF + '.rules=rules'],
		['set', CONF + '.rules.geosite_cn=' + (p.geosite_cn || 'DIRECT')],
		['set', CONF + '.rules.geoip_cn=' + (p.geoip_cn || 'DIRECT')],
		['set', CONF + '.rules.default_policy=' + (p.default_policy || 'PROXY')],
		['commit', CONF]
	]).then(function () {
		return Promise.all([
			fs.write('/etc/kanno/rules/force_proxy.txt', fp),
			fs.write('/etc/kanno/rules/force_direct.txt', fd)
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
			ipv6:      uci.get(CONF, 'global', 'ipv6') === '1'
		};
	});
}
function saveGlobal(p) {
	var kernel = (p.kernel === 'mihomo' || p.kernel === 'singbox') ? p.kernel : 'mihomo';
	var mode   = ({ rule: 1, global: 1, direct: 1 }[p.mode]) ? p.mode : 'rule';
	var level  = LOGLEVELS[p.log_level] ? p.log_level : 'info';
	return uciBatch([
		['set', CONF + '.global=global'],
		['set', CONF + '.global.kernel=' + kernel],
		['set', CONF + '.global.mode=' + mode],
		['set', CONF + '.global.log_level=' + level],
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
		Promise.all([
			fs.read('/etc/kanno/geodata/version').then(function (t) { return (t || '').trim(); }).catch(function () { return ''; }),
			fs.stat('/etc/kanno/geodata/geoip.dat').then(function () { return 'yes'; }).catch(function () { return 'no'; }),
			fs.stat('/etc/kanno/geodata/geosite.dat').then(function () { return 'yes'; }).catch(function () { return 'no'; })
		]).then(function (a) { return { version: a[0], geoip: a[1], geosite: a[2] }; })
	]).then(function (a) { return { mihomo: a[0], singbox: a[1], geodata: a[2] }; });
}
function updateKernel(p) {
	var t = p.target;
	if (!/^[a-z]+$/.test(t || ''))
		return Promise.resolve({ ok: false, error: 'invalid target' });
	return bg(KANNO + ' update ' + t + ' >/tmp/kanno-update.log 2>&1 &').then(function () {
		return { ok: true, message: 'Update started in background — check the Logs tab' };
	});
}

/* ── Logs ───────────────────────────────────────────────── */
function getLogs(p) {
	var n = parseInt(p.lines, 10) || 100;
	if (n > 500) n = 500;
	return fs.read_direct(LOG, 'text')
		.catch(function () { return fs.read(LOG).catch(function () { return ''; }); })
		.then(function (txt) {
			var lines = (txt || '').replace(/\s+$/, '').split('\n').filter(function (l) { return l.length; });
			if (lines.length > n) lines = lines.slice(lines.length - n);
			return { lines: lines };
		});
}

/* ── Traffic (mihomo connections API) ──────────── */
function getTraffic() {
	return out('/usr/bin/curl', ['-sf', '--max-time', '2', 'http://127.0.0.1:9090/connections'])
		.then(function (s) {
			try {
				var o = JSON.parse(s);
				return {
					up: o.uploadTotal || 0,
					down: o.downloadTotal || 0,
					conns: Array.isArray(o.connections) ? o.connections.length : 0,
					mem: o.memory || 0
				};
			} catch (e) {
				return { up: 0, down: 0, conns: 0, mem: 0 };
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
	if (cmds.length === 0) return Promise.resolve({ ok: true });
	cmds.push(['commit', CONF]);
	return uciBatch(cmds).then(refresh).then(function () { return { ok: true }; });
}

/* ── Kernel upload install (file already in /tmp via cgi-io) */
function installUpload(p) {
	var target = p.target;
	if (target !== 'mihomo' && target !== 'singbox')
		return Promise.resolve({ ok: false, error: 'invalid target' });
	var dest = target === 'mihomo' ? '/usr/bin/mihomo' : '/usr/bin/sing-box';
	var src = '/tmp/kanno-upload.bin';
	var cmd = 'T=/tmp/kanno-ext-$$; U=/tmp/kanno-ungz-$$; mkdir -p "$T"; '
		+ 'if tar -xzf ' + src + ' -C "$T" 2>/dev/null; then '
		+ '  F=$(find "$T" -type f ! -name "*.sha256" | head -1); '
		+ '  [ -n "$F" ] && mv "$F" ' + dest + '; '
		+ 'elif gzip -d -c ' + src + ' > "$U" 2>/dev/null; then '
		+ '  mv "$U" ' + dest + '; '
		+ 'else '
		+ '  mv ' + src + ' ' + dest + '; '
		+ 'fi; chmod +x ' + dest + '; rm -rf ' + src + ' "$T" "$U"';
	return exec('/bin/sh', ['-c', cmd]).then(function (r) {
		if (r.code === 0) return { ok: true };
		return { ok: false, error: (r.stderr || 'install failed').split('\n')[0] };
	});
}

var DISPATCH = {
	get_status: getStatus, get_nodes: getNodes, add_node: addNode, del_node: delNode,
	toggle_node: toggleNode, test_node: testNode, test_all_nodes: testAll,
	restart: restart, stop: stopSvc, get_groups: getGroups, save_groups: saveGroups,
	get_rules: getRules, save_rules: saveRules, get_dns: getDns, save_dns: saveDns,
	get_global: getGlobal, save_global: saveGlobal, get_kernels: getKernels,
	update_kernel: updateKernel, get_logs: getLogs,
	get_traffic: getTraffic, check_access: checkAccess, set_mode: setMode,
	install_upload: installUpload
};

return baseclass.extend({
	call: function (method, params) {
		var fn = DISPATCH[method];
		if (!fn) return Promise.reject(new Error('unknown method: ' + method));
		try { return Promise.resolve(fn(params || {})); }
		catch (e) { return Promise.reject(e); }
	}
});
