'use strict';
'require view';
'require ui';
'require request';
'require tomfly.api as api';
'require tomfly.kernel-profile as kprof';

document.querySelector('head').appendChild(E('link', {
	'rel': 'stylesheet', 'type': 'text/css',
	'href': L.resource('view/tomfly/style.css')
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
		return E('div', { 'class': 'tomfly-card tomfly-kernel' }, [
			E('div', { 'class': 'tomfly-kernel-badge tomfly-ic-' + cls }, badge),
			E('div', { 'class': 'tomfly-kernel-name' }, name),
			E('div', { 'class': 'tomfly-kernel-ver' }, ver || _('not installed')),
			E('div', { 'style': 'margin-bottom:10px' }, [
				E('span', { 'class': 'tomfly-pill ' + (installed ? 'tomfly-pill-on' : 'tomfly-pill-off') }, statusText)
			]),
			E('div', { 'class': 'tomfly-actions', 'style': 'justify-content:center' }, [
				E('button', {
					'class': 'cbi-button cbi-button-action important',
					'click': ui.createHandlerFn(this, 'handleUpdate', target)
				}, _('Update online')),
				E('button', {
					'class': 'cbi-button cbi-button-action',
					'click': ui.createHandlerFn(this, 'handleUpload', target)
				}, _('Upload'))
			])
		]);
	},

	render: function (data) {
		var g = data[0] || {}, k = data[1] || {};
		var mihomo = k.mihomo || {}, singbox = k.singbox || {}, geo = k.geodata || {};
		var geoOk = (geo.geoip === 'yes' && geo.geosite === 'yes');
		var kernel = g.kernel || 'mihomo';

		var kernelSelect = select('k-kernel', kernel, [
			['mihomo', 'mihomo ' + _('(recommended)')], ['singbox', 'sing-box']
		]);
		var kernelNote = E('div', { 'class': 'tomfly-kernel-note', 'id': 'k-kernel-note' });
		var updateKernelNote = function () {
			var sel = document.getElementById('k-kernel');
			var kp = kprof.profile((sel && sel.value) || kernel);
			if (kp.tunAlwaysOn) {
				kernelNote.textContent = _(
					'sing-box always uses TUN (interface TomFly) for traffic capture. ' +
					'mihomo can switch between TPROXY and TUN on the Overview page.');
			} else {
				kernelNote.textContent = _(
					'mihomo defaults to TPROXY; enable TUN on the Overview page if you prefer kernel-managed routing. ' +
					'sing-box only supports TUN mode.');
			}
		};
		kernelSelect.addEventListener('change', updateKernelNote);
		window.setTimeout(updateKernelNote, 0);

		return E('div', { 'class': 'tomfly' }, [
			E('div', { 'class': 'tomfly-card' }, [
				E('div', { 'class': 'tomfly-card-title' }, [
					_('Global Settings'),
					' ',
					kprof.badge(kernel)
				]),
				row(_('Active Kernel'), E('div', {}, [kernelSelect, kernelNote])),
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
			E('div', { 'class': 'tomfly-grid' }, [
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
					var done = target === 'geodata'
						? (info.geoip === 'yes' && info.geosite === 'yes')
						: !!info.installed;
					if (done) {
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
		var self = this;
		var isGeo = target === 'geodata';
		var kindSelect = isGeo ? E('select', {
			'class': 'cbi-input-select', 'id': 'tomfly-geodata-kind', 'style': 'width:100%;margin:8px 0'
		}, [
			E('option', { value: 'bundle' }, _('Archive with geoip.dat + geosite.dat (.tar.gz)')),
			E('option', { value: 'geoip' }, _('GeoIP only (geoip.dat or .gz)')),
			E('option', { value: 'geosite' }, _('GeoSite only (geosite.dat or .gz)'))
		]) : null;
		var fileInput = E('input', {
			'type': 'file',
			'accept': isGeo ? '.dat,.gz,.tar,.tar.gz,.tgz' : '.gz,.tar.gz,.tgz',
			'style': 'margin:10px 0'
		});
		ui.showModal(_('Upload ') + target, [
			E('p', { 'class': 'tomfly-muted' }, isGeo
				? _('Upload Loyalsoldier/v2ray-rules-dat release files for mihomo GeoIP/GeoSite rules.')
				: _('Select the compressed kernel binary (.gz or .tar.gz)')),
			isGeo ? kindSelect : '',
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
						var kindEl = document.getElementById('tomfly-geodata-kind');
						var kind = (kindEl && kindEl.value) || 'bundle';
						ui.showModal(_('Uploading…'), [
							E('p', { 'class': 'spinning' }, _('Uploading file…'))
						]);
						var fd = new FormData();
						fd.append('sessionid', L.env.sessionid);
						fd.append('filename', '/tmp/tomfly-upload.bin');
						fd.append('filedata', file);
						return request.post('/cgi-bin/cgi-upload', fd, {
							timeout: 120000
						}).then(function (res) {
							if (!res.ok)
								throw new Error(res.status === 404
									? 'cgi-io not available (apk add cgi-io)'
									: 'HTTP ' + res.status);
							ui.showModal(_('Installing…'), [
								E('p', { 'class': 'spinning' }, isGeo
									? _('Installing geodata…')
									: _('Decompressing and installing…'))
							]);
							var payload = { target: target };
							if (isGeo) payload.kind = kind;
							return api.call('install_upload', payload);
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
