'use strict';
'require view';
'require ui';
'require request';
'require kanno.api as api';

document.querySelector('head').appendChild(E('link', {
	'rel': 'stylesheet', 'type': 'text/css',
	'href': L.resource('view/kanno/style.css')
}));

function notify(content, ms) {
	var el = ui.addNotification(null, content);
	if (ms > 0) window.setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, ms);
}

function row(label, field) {
	return E('div', { 'class': 'cbi-value' }, [
		E('label', { 'class': 'cbi-value-title' }, label),
		E('div', { 'class': 'cbi-value-field' }, [field])
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
		return Promise.all([
			L.resolveDefault(api.call('get_global'), {}),
			L.resolveDefault(api.call('get_kernels'), {})
		]);
	},

	kernelCard: function (badge, cls, name, ver, installed, target, statusText) {
		return E('div', { 'class': 'kanno-card kanno-kernel' }, [
			E('div', { 'class': 'kanno-kernel-badge kanno-ic-' + cls }, badge),
			E('div', { 'class': 'kanno-kernel-name' }, name),
			E('div', { 'class': 'kanno-kernel-ver' }, ver || _('not installed')),
			E('div', { 'style': 'margin-bottom:10px' }, [
				E('span', { 'class': 'kanno-pill ' + (installed ? 'kanno-pill-on' : 'kanno-pill-off') }, statusText)
			]),
			E('div', { 'class': 'kanno-actions', 'style': 'justify-content:center' }, [
				E('button', {
					'class': 'cbi-button cbi-button-action important',
					'click': ui.createHandlerFn(this, 'handleUpdate', target)
				}, _('Update online')),
				target !== 'geodata' ? E('button', {
					'class': 'cbi-button cbi-button-action',
					'click': ui.createHandlerFn(this, 'handleUpload', target)
				}, _('Upload')) : ''
			])
		]);
	},

	render: function (data) {
		var g = data[0] || {}, k = data[1] || {};
		var mihomo = k.mihomo || {}, singbox = k.singbox || {}, geo = k.geodata || {};
		var geoOk = (geo.geoip === 'yes' && geo.geosite === 'yes');

		return E('div', { 'class': 'kanno' }, [
			E('div', { 'class': 'kanno-card' }, [
				E('div', { 'class': 'kanno-card-title' }, _('Global Settings')),
				row(_('Active Kernel'), select('k-kernel', g.kernel || 'mihomo', [
					['mihomo', 'mihomo ' + _('(recommended)')], ['singbox', 'sing-box']
				])),
				row(_('Proxy Mode'), select('k-mode', g.mode || 'rule', [
					['rule', _('Rule')], ['global', _('Global')], ['direct', _('Direct')]
				])),
				row(_('Log Level'), select('k-log', g.log_level || 'info', [
					['silent', 'Silent'], ['error', 'Error'], ['warning', 'Warning'], ['info', 'Info'], ['debug', 'Debug']
				])),
				E('div', { 'class': 'cbi-value', 'style': 'border:none' }, [
					E('label', { 'class': 'cbi-value-title' }, ''),
					E('div', { 'class': 'cbi-value-field' }, [
						E('button', { 'class': 'cbi-button cbi-button-save important', 'click': ui.createHandlerFn(this, 'handleSaveGlobal') }, _('Save'))
					])
				])
			]),
			E('div', { 'class': 'kanno-grid' }, [
				this.kernelCard('M', 'blue', 'mihomo', mihomo.version, mihomo.installed, 'mihomo',
					mihomo.installed ? _('installed') : _('not installed')),
				this.kernelCard('S', 'red', 'sing-box', singbox.version, singbox.installed, 'singbox',
					singbox.installed ? _('installed') : _('not installed')),
				this.kernelCard('G', 'green', 'GeoData', geo.version, geoOk, 'geodata',
					geoOk ? _('GeoIP + GeoSite') : _('missing data'))
			])
		]);
	},

	handleSaveGlobal: function () {
		var payload = {
			kernel: document.getElementById('k-kernel').value,
			mode: document.getElementById('k-mode').value,
			log_level: document.getElementById('k-log').value
		};
		return api.call('save_global', payload).then(function (r) {
			if (r && r.ok)
				notify(E('p', _('Settings saved — restart to apply')), 3500);
			else
				ui.addNotification(null, E('p', _('Save failed')), 'danger');
		}).catch(function (e) {
			ui.addNotification(null, E('p', _('Save failed: ') + e.message), 'danger');
		});
	},

	handleUpdate: function (target) {
		var self = this;
		return api.call('update_kernel', { target: target }).then(function (r) {
			ui.showModal(_('Updating ') + target, [
				E('p', { 'class': 'spinning' }, _('Downloading and installing — this may take a minute…'))
			]);
			var attempts = 0;
			var poll = window.setInterval(function () {
				attempts++;
				if (attempts > 40) {
					window.clearInterval(poll);
					ui.hideModal();
					ui.addNotification(null, E('p', _('Update timed out — check the Logs tab')), 'warning');
					return;
				}
				L.resolveDefault(api.call('get_kernels'), {}).then(function (k) {
					var info = k[target] || k[target === 'singbox' ? 'singbox' : target] || {};
					if (info.installed) {
						window.clearInterval(poll);
						ui.hideModal();
						notify(E('p', target + ' ' + _('updated successfully')), 4000);
						window.location.reload();
					}
				});
			}, 3000);
		}).catch(function (e) {
			ui.hideModal();
			ui.addNotification(null, E('p', _('Update failed: ') + e.message), 'danger');
		});
	},

	handleUpload: function (target) {
		var fileInput = E('input', {
			'type': 'file',
			'accept': '.gz,.tar.gz,.tgz',
			'style': 'margin:10px 0'
		});
		ui.showModal(_('Upload ') + target, [
			E('p', { 'class': 'kanno-muted' },
				_('Select the compressed kernel binary (.gz or .tar.gz)')),
			fileInput,
			E('div', { 'class': 'right', 'style': 'margin-top:14px' }, [
				E('button', {
					'class': 'cbi-button',
					'click': ui.hideModal
				}, _('Cancel')),
				' ',
				E('button', {
					'class': 'cbi-button cbi-button-save important',
					'click': ui.createHandlerFn(this, function () {
						var file = fileInput.files && fileInput.files[0];
						if (!file) return;
						ui.showModal(_('Uploading…'), [
							E('p', { 'class': 'spinning' }, _('Uploading file…'))
						]);
						var fd = new FormData();
						fd.append('sessionid', L.env.sessionid);
						fd.append('filename', '/tmp/kanno-upload.bin');
						fd.append('filedata', file);
						return request.post('/cgi-bin/cgi-upload', fd, {
							timeout: 120000
						}).then(function (res) {
							if (!res.ok)
								throw new Error(res.status === 404
									? 'cgi-io not available (apk add cgi-io)'
									: 'HTTP ' + res.status);
							ui.showModal(_('Installing…'), [
								E('p', { 'class': 'spinning' }, _('Decompressing and installing…'))
							]);
							return api.call('install_upload', { target: target });
						}).then(function (r) {
							ui.hideModal();
							if (r && r.ok) {
								notify(E('p', target + ' ' + _('installed')), 4000);
								window.location.reload();
							} else {
								ui.addNotification(null,
									E('p', _('Install failed: ') + ((r && r.error) || '')), 'danger');
							}
						}).catch(function (e) {
							ui.hideModal();
							ui.addNotification(null,
								E('p', _('Upload failed: ') + e.message), 'danger');
						});
					})
				}, _('Upload & Install'))
			])
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
