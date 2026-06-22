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

function select(id, value, opts) {
	var el = E('select', { 'class': 'cbi-input-select', 'id': id },
		opts.map(function (o) { return E('option', { 'value': o[0] }, o[1]); }));
	el.value = value;
	return el;
}

return view.extend({
	load: function () {
		return L.resolveDefault(api.call('get_dns'), {});
	},

	render: function (d) {
		d = d || {};
		return E('div', { 'class': 'kanno' }, [
			E('div', { 'class': 'kanno-card' }, [
				E('div', { 'class': 'kanno-card-title' }, _('DNS Settings')),
				row(_('DNS Mode'),
					select('k-dns-mode', d.mode || 'fake-ip', [
						['fake-ip', _('Fake-IP (recommended, anti-pollution)')],
						['redir-host', _('Redir-Host (compatibility)')]
					])),
				row(_('Listen Port'),
					E('input', { 'class': 'cbi-input-text', 'id': 'k-dns-port', 'type': 'number', 'value': d.listen_port || 1053 })),
				row(_('Domestic DNS'),
					E('textarea', { 'class': 'cbi-input-textarea', 'id': 'k-dns-dom', 'rows': 4, 'style': 'width:100%', 'placeholder': '114.114.114.114\n223.5.5.5' },
						(d.domestic_dns || []).join('\n')),
					_('Resolved directly. One server per line.')),
				row(_('Foreign DNS'),
					E('textarea', { 'class': 'cbi-input-textarea', 'id': 'k-dns-for', 'rows': 4, 'style': 'width:100%', 'placeholder': '8.8.8.8\n1.1.1.1' },
						(d.foreign_dns || []).join('\n')),
					_('Resolved through the proxy. One server per line.'))
			]),
			E('div', { 'class': 'cbi-page-actions' }, [
				E('button', { 'class': 'cbi-button cbi-button-save important', 'click': ui.createHandlerFn(this, 'handleSaveDns') }, _('Save'))
			])
		]);
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
