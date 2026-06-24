'use strict';
'require view';
'require ui';
'require tomfly.api as api';
'require tomfly.kernel-profile as kprof';
'require tomfly.widgets as widgets';

widgets.mount();

function notify(content, ms) {
	var el = ui.addNotification(null, content);
	if (ms > 0) window.setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, ms);
}

function field(label, control, hint) {
	return E('div', {}, [
		E('div', { 'class': 'tomfly-flabel', 'style': 'margin-top:0' }, label),
		control,
		hint ? E('div', { 'class': 'tomfly-fhint' }, hint) : ''
	]);
}

return view.extend({
	load: function () {
		return Promise.all([
			L.resolveDefault(api.call('get_dns'), {}),
			L.resolveDefault(api.call('get_global'), {})
		]);
	},

	render: function (data) {
		var d = data[0] || {};
		var kernel = (data[1] || {}).kernel || 'mihomo';
		var kp = kprof.profile(kernel);
		var banners = [];

		if (kp.dnsFirstOnly) {
			banners.push(widgets.banner('warn', [
				E('strong', {}, _('sing-box: ')),
				_('Only the first domestic and foreign DNS server in each list is written to config.')
			]));
		} else {
			banners.push(widgets.banner('info', [
				E('strong', {}, _('mihomo: ')),
				_('DNS resolution strategy. Fake-IP effectively prevents DNS pollution — recommended.')
			]));
		}

		var modeSelect = E('select', { 'class': 'tomfly-select', 'id': 'k-dns-mode' }, [
			E('option', { 'value': 'fake-ip' }, _('Fake-IP (recommended, anti-pollution)')),
			E('option', { 'value': 'redir-host' }, _('Redir-Host (compatibility)'))
		]);
		modeSelect.value = d.mode || 'fake-ip';

		var portInput = E('input', { 'class': 'tomfly-input', 'id': 'k-dns-port', 'type': 'number', 'value': d.listen_port || 1053 });

		var domestic = E('textarea', { 'class': 'tomfly-textarea', 'id': 'k-dns-dom', 'rows': 4, 'placeholder': '114.114.114.114\n223.5.5.5' },
			(d.domestic_dns || []).join('\n'));
		var foreign = E('textarea', { 'class': 'tomfly-textarea', 'id': 'k-dns-for', 'rows': 4, 'placeholder': '8.8.8.8\n1.1.1.1' },
			(d.foreign_dns || []).join('\n'));

		return E('div', { 'class': 'tomfly-app' }, [
			widgets.nav('dns', [kprof.badge(kernel)])
		].concat(banners).concat([
			E('div', { 'class': 'tomfly-card' }, [
				E('div', { 'class': 'tomfly-card-head', 'style': 'margin-bottom:20px' }, [
					E('div', { 'class': 'tomfly-card-title' }, _('DNS Settings')),
					kprof.badge(kernel)
				]),
				E('div', { 'class': 'tomfly-grid-2' }, [
					field(_('DNS Mode'), modeSelect),
					field(_('Listen Port'), portInput)
				]),
				E('div', { 'class': 'tomfly-grid-2', 'style': 'margin-top:18px' }, [
					field(_('Domestic DNS'), domestic, _('Resolved directly. One server per line.')),
					field(_('Foreign DNS'), foreign, _('Resolved through the proxy. One server per line.'))
				])
			]),
			E('div', { 'class': 'tomfly-actions-end' }, [
				E('button', { 'class': 'tomfly-btn tomfly-btn-primary', 'click': ui.createHandlerFn(this, 'handleSaveDns') }, _('Save'))
			])
		]));
	},

	handleSaveDns: function () {
		function lines(id) {
			var el = document.getElementById(id);
			return (el && el.value || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
		}
		var payload = {
			mode: document.getElementById('k-dns-mode').value,
			listen_port: parseInt(document.getElementById('k-dns-port').value, 10) || 1053,
			domestic_dns: lines('k-dns-dom'),
			foreign_dns: lines('k-dns-for')
		};
		return api.call('save_dns', payload).then(function (r) {
			if (r && r.ok)
				notify(E('p', _('DNS settings saved — restart to apply')), 3500);
			else
				ui.addNotification(null, E('p', _('Save failed')), 'danger');
		}).catch(function (e) {
			ui.addNotification(null, E('p', _('Save failed: ') + e.message), 'danger');
		});
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
