'use strict';
'require view';
'require ui';
'require kanno.api as api';

document.querySelector('head').appendChild(E('link', {
	'rel': 'stylesheet', 'type': 'text/css',
	'href': L.resource('view/kanno/style.css')
}));

function notify(content, ms) {
	var el = ui.addNotification(null, content);
	if (ms > 0) window.setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, ms);
}

function row(label, field, desc) {
	return E('div', { 'class': 'cbi-value' }, [
		E('label', { 'class': 'cbi-value-title' }, label),
		E('div', { 'class': 'cbi-value-field' },
			desc ? [field, E('div', { 'class': 'cbi-value-description' }, desc)] : [field])
	]);
}

function policy(id, value) {
	var el = E('select', { 'class': 'cbi-input-select', 'id': id }, [
		E('option', { 'value': 'PROXY' }, _('Proxy')),
		E('option', { 'value': 'DIRECT' }, _('Direct'))
	]);
	el.value = value || 'DIRECT';
	return el;
}

return view.extend({
	load: function () {
		return L.resolveDefault(api.call('get_rules'), {});
	},

	render: function (r) {
		r = r || {};
		return E('div', { 'class': 'kanno' }, [
			E('div', { 'class': 'kanno-grid-2' }, [
				E('div', { 'class': 'kanno-card' }, [
					E('div', { 'class': 'kanno-card-title' }, _('Routing Policy')),
					row(_('GeoSite CN'), policy('k-geosite', r.geosite_cn)),
					row(_('GeoIP CN'), policy('k-geoip', r.geoip_cn)),
					row(_('Default Policy'), policy('k-default', r.default_policy), _('Used when no rule matches.'))
				]),
				E('div', { 'class': 'kanno-card' }, [
					E('div', { 'class': 'kanno-card-title' }, _('How rules are applied')),
					E('ul', { 'class': 'kanno-tips' }, [
						E('li', {}, _('Force Proxy > Force Direct > GeoSite/GeoIP > Default')),
						E('li', {}, _('One entry per line: domain suffix, full domain, or CIDR')),
						E('li', {}, _('LAN addresses (192.168.x.x …) are always direct')),
						E('li', {}, _('Save then restart for changes to take effect'))
					])
				])
			]),
			E('div', { 'class': 'kanno-grid-2' }, [
				E('div', { 'class': 'kanno-card' }, [
					E('div', { 'class': 'kanno-card-title' }, _('Force Proxy')),
					E('textarea', { 'class': 'cbi-input-textarea', 'id': 'k-fproxy', 'rows': 10, 'style': 'width:100%;font-family:var(--font-mono,monospace)', 'placeholder': 'google.com\n8.8.8.8/32\n*.googleapis.com' },
						(r.force_proxy || []).join('\n'))
				]),
				E('div', { 'class': 'kanno-card' }, [
					E('div', { 'class': 'kanno-card-title' }, _('Force Direct')),
					E('textarea', { 'class': 'cbi-input-textarea', 'id': 'k-fdirect', 'rows': 10, 'style': 'width:100%;font-family:var(--font-mono,monospace)', 'placeholder': 'localserver.home\n192.168.100.0/24' },
						(r.force_direct || []).join('\n'))
				])
			]),
			E('div', { 'class': 'cbi-page-actions' }, [
				E('button', { 'class': 'cbi-button cbi-button-save important', 'click': ui.createHandlerFn(this, 'handleSaveRules') }, _('Save'))
			])
		]);
	},

	handleSaveRules: function () {
		function lines(id) {
			var el = document.getElementById(id);
			return (el && el.value || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
		}
		var payload = {
			geosite_cn: document.getElementById('k-geosite').value,
			geoip_cn: document.getElementById('k-geoip').value,
			default_policy: document.getElementById('k-default').value,
			force_proxy: lines('k-fproxy'),
			force_direct: lines('k-fdirect')
		};
		return api.call('save_rules', payload).then(function (r) {
			if (r && r.ok)
				notify(E('p', _('Rules saved — restart to apply')), 3500);
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
