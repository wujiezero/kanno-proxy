'use strict';
'require view';
'require ui';
'require poll';
'require dom';
'require kanno.api as api';

document.querySelector('head').appendChild(E('link', {
	'rel': 'stylesheet', 'type': 'text/css',
	'href': L.resource('view/kanno/style.css')
}));

function svg(paths) {
	var s = E('span');
	s.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
		'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22">' +
		paths + '</svg>';
	return s.firstChild;
}

var ICON = {
	up:   '<polyline points="17 11 12 6 7 11"/><line x1="12" y1="18" x2="12" y2="6"/>',
	down: '<polyline points="7 13 12 18 17 13"/><line x1="12" y1="6" x2="12" y2="18"/>',
	link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
	mem:  '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>'
};

function notify(content, ms) {
	var el = ui.addNotification(null, content);
	if (ms > 0) window.setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, ms);
}

var _prevUp = 0, _prevDown = 0, _prevTs = 0;

function fmtSpeed(bps) {
	if (bps < 1024) return bps.toFixed(0) + ' B/s';
	if (bps < 1048576) return (bps / 1024).toFixed(1) + ' KB/s';
	return (bps / 1048576).toFixed(2) + ' MB/s';
}

function fmtBytes(b) {
	if (b < 1024) return b + ' B';
	if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
	if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
	return (b / 1073741824).toFixed(2) + ' GB';
}

return view.extend({
	load: function () {
		return Promise.all([
			L.resolveDefault(api.call('get_status'), {}),
			L.resolveDefault(api.call('get_traffic'), {}),
			L.resolveDefault(api.call('get_global'), {}),
			L.resolveDefault(api.call('get_dns'), {})
		]);
	},

	statusInner: function (s) {
		s = s || {};
		var running = !!s.running;
		return [
			E('span', { 'class': 'kanno-pill ' + (running ? 'kanno-pill-on' : 'kanno-pill-off') }, [
				E('span', { 'class': 'kanno-dot' }), running ? _('Running') : _('Stopped')
			]),
			s.version ? E('span', { 'class': 'kanno-muted' }, s.version) : '',
			E('div', { 'class': 'kanno-actions' }, [
				E('button', {
					'class': 'cbi-button cbi-button-save important',
					'click': ui.createHandlerFn(this, 'handleAction', 'restart')
				}, running ? _('Restart') : _('Start')),
				running ? E('button', {
					'class': 'cbi-button cbi-button-remove important',
					'click': ui.createHandlerFn(this, 'handleAction', 'stop')
				}, _('Stop')) : ''
			])
		];
	},

	trafficInner: function (t) {
		t = t || {};
		var now = Date.now();
		var dt = _prevTs ? (now - _prevTs) / 1000 : 0;
		var upSpd  = (dt > 0.5 && (t.up || 0) >= _prevUp)   ? ((t.up || 0) - _prevUp) / dt   : 0;
		var dnSpd  = (dt > 0.5 && (t.down || 0) >= _prevDown) ? ((t.down || 0) - _prevDown) / dt : 0;
		_prevUp = t.up || 0;
		_prevDown = t.down || 0;
		_prevTs = now;

		return [
			E('div', { 'class': 'kanno-card kanno-stat' }, [
				E('div', { 'class': 'kanno-stat-icon kanno-ic-green' }, svg(ICON.up)),
				E('div', {}, [
					E('div', { 'class': 'kanno-stat-value' }, fmtSpeed(upSpd)),
					E('div', { 'class': 'kanno-stat-label' }, _('Upload') + ' · ' + fmtBytes(t.up || 0))
				])
			]),
			E('div', { 'class': 'kanno-card kanno-stat' }, [
				E('div', { 'class': 'kanno-stat-icon kanno-ic-blue' }, svg(ICON.down)),
				E('div', {}, [
					E('div', { 'class': 'kanno-stat-value' }, fmtSpeed(dnSpd)),
					E('div', { 'class': 'kanno-stat-label' }, _('Download') + ' · ' + fmtBytes(t.down || 0))
				])
			]),
			E('div', { 'class': 'kanno-card kanno-stat' }, [
				E('div', { 'class': 'kanno-stat-icon kanno-ic-amber' }, svg(ICON.link)),
				E('div', {}, [
					E('div', { 'class': 'kanno-stat-value' }, String(t.conns || 0)),
					E('div', { 'class': 'kanno-stat-label' }, _('Connections'))
				])
			]),
			E('div', { 'class': 'kanno-card kanno-stat' }, [
				E('div', { 'class': 'kanno-stat-icon kanno-ic-indigo' }, svg(ICON.mem)),
				E('div', {}, [
					E('div', { 'class': 'kanno-stat-value' }, fmtBytes(t.mem || 0)),
					E('div', { 'class': 'kanno-stat-label' }, _('Memory'))
				])
			])
		];
	},

	render: function (data) {
		var s = data[0] || {}, traffic = data[1] || {};
		var global = data[2] || {}, dns = data[3] || {};

		var statusCard = E('div', { 'class': 'kanno-card' }, [
			E('div', { 'class': 'kanno-card-title' }, _('Service Status')),
			E('div', { 'id': 'kanno-status', 'class': 'kanno-row' }, this.statusInner(s))
		]);

		var trafficGrid = E('div', { 'id': 'kanno-traffic', 'class': 'kanno-grid' },
			this.trafficInner(traffic));

		var accessCard = E('div', { 'class': 'kanno-card' }, [
			E('div', { 'class': 'kanno-row', 'style': 'margin-bottom:10px' }, [
				E('span', { 'class': 'kanno-card-title', 'style': 'margin:0' }, _('Access Check')),
				E('button', {
					'class': 'cbi-button cbi-button-action',
					'style': 'padding:2px 14px;font-size:12px',
					'id': 'kanno-check-btn',
					'click': ui.createHandlerFn(this, 'handleCheck')
				}, _('Check'))
			]),
			E('div', { 'id': 'kanno-access' }, [
				E('span', { 'class': 'kanno-muted' }, _('Click Check to test connectivity'))
			])
		]);

		var modeSelect = E('select', { 'class': 'cbi-input-select', 'id': 'kanno-mode' }, [
			E('option', { value: 'rule' }, _('Rule')),
			E('option', { value: 'global' }, _('Global')),
			E('option', { value: 'direct' }, _('Direct'))
		]);
		modeSelect.value = global.mode || 'rule';

		var dnsSelect = E('select', { 'class': 'cbi-input-select', 'id': 'kanno-dns-mode' }, [
			E('option', { value: 'fake-ip' }, 'Fake-IP'),
			E('option', { value: 'redir-host' }, 'Redir-Host')
		]);
		dnsSelect.value = dns.mode || 'fake-ip';

		var settingsCard = E('div', { 'class': 'kanno-card' }, [
			E('div', { 'class': 'kanno-card-title' }, _('Quick Settings')),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Proxy Mode')),
				E('div', { 'class': 'cbi-value-field' }, [modeSelect])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Running Mode')),
				E('div', { 'class': 'cbi-value-field' }, [dnsSelect])
			]),
			E('div', { 'style': 'text-align:right;margin-top:6px' }, [
				E('button', {
					'class': 'cbi-button cbi-button-save important',
					'click': ui.createHandlerFn(this, 'handleSaveSettings')
				}, _('Save & Restart'))
			])
		]);

		var quick = E('div', { 'class': 'kanno-card' }, [
			E('div', { 'class': 'kanno-card-title' }, _('Quick Add Node')),
			E('div', { 'class': 'kanno-row' }, [
				E('input', {
					'class': 'cbi-input-text', 'id': 'kanno-quick', 'type': 'text',
					'style': 'flex:1;min-width:240px',
					'placeholder': 'vless:// vmess:// trojan:// ss:// hy2:// tuic://',
					'keydown': L.bind(function (ev) {
						if (ev.keyCode === 13) this.handleQuickAdd(ev);
					}, this)
				}),
				E('button', {
					'class': 'cbi-button cbi-button-action important',
					'click': ui.createHandlerFn(this, 'handleQuickAdd')
				}, _('Add'))
			])
		]);

		poll.add(L.bind(function () {
			return Promise.all([
				L.resolveDefault(api.call('get_status'), {}),
				L.resolveDefault(api.call('get_traffic'), {})
			]).then(L.bind(function (r) {
				var el = document.getElementById('kanno-status');
				if (el) dom.content(el, this.statusInner(r[0]));
				var tel = document.getElementById('kanno-traffic');
				if (tel) dom.content(tel, this.trafficInner(r[1]));
			}, this));
		}, this), 3);

		return E('div', { 'class': 'kanno' }, [
			statusCard, trafficGrid,
			E('div', { 'class': 'kanno-grid-2' }, [accessCard, settingsCard]),
			quick
		]);
	},

	handleAction: function (act) {
		var self = this;
		return api.call(act).then(function () {
			notify(
				E('p', act === 'stop' ? _('Service stopped') : _('Service is (re)starting…')),
				3000);
			return new Promise(function (res) { window.setTimeout(res, act === 'stop' ? 1500 : 2500); });
		}).then(function () {
			return L.resolveDefault(api.call('get_status'), {});
		}).then(function (st) {
			var el = document.getElementById('kanno-status');
			if (el) dom.content(el, self.statusInner(st));
		});
	},

	handleCheck: function () {
		var btn = document.getElementById('kanno-check-btn');
		var el = document.getElementById('kanno-access');
		if (btn) btn.disabled = true;
		dom.content(el, E('span', { 'class': 'kanno-muted' }, _('Checking…')));
		return api.call('check_access').then(function (r) {
			var sites = (r && r.sites) || [];
			dom.content(el, sites.map(function (s) {
				return E('div', { 'class': 'kanno-access-item' }, [
					E('span', { 'class': 'kanno-access-dot ' + (s.ok ? 'ok' : 'fail') }),
					E('span', { 'class': 'kanno-access-name' }, s.name),
					E('span', { 'class': 'kanno-access-result ' + (s.ok ? 'ok' : 'fail') },
						s.ok ? s.latency + ' ms' : 'Timeout')
				]);
			}));
			if (btn) btn.disabled = false;
		}).catch(function () {
			dom.content(el, E('span', { 'class': 'kanno-muted' }, _('Check failed')));
			if (btn) btn.disabled = false;
		});
	},

	handleSaveSettings: function () {
		var mode = document.getElementById('kanno-mode').value;
		var dnsMode = document.getElementById('kanno-dns-mode').value;
		return api.call('set_mode', { mode: mode, dns_mode: dnsMode }).then(function () {
			return api.call('restart');
		}).then(function () {
			notify(E('p', _('Settings saved, restarting…')), 3000);
		}).catch(function (e) {
			ui.addNotification(null, E('p', _('Save failed: ') + e.message), 'danger');
		});
	},

	handleQuickAdd: function () {
		var inp = document.getElementById('kanno-quick');
		var uri = (inp && inp.value || '').trim();
		if (!uri) return;
		return api.call('add_node', { uri: uri }).then(function (r) {
			if (r && r.ok) {
				notify(E('p', _('Node added: ') + (r.name || uri)), 3000);
				if (inp) inp.value = '';
			} else {
				ui.addNotification(null,
					E('p', _('Add failed: ') + ((r && r.error) || _('parse error'))), 'danger');
			}
		}).catch(function (e) {
			ui.addNotification(null, E('p', _('Add failed: ') + e.message), 'danger');
		});
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
