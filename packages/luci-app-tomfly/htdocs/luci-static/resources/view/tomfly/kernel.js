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

function geoUpdateDone(target, geo) {
	geo = geo || {};
	if (target === 'geodata_mihomo')
		return geo.geoip === 'yes' && geo.geosite === 'yes';
	if (target === 'geodata_singbox')
		return geo.srs_geoip === 'yes' && geo.srs_geosite === 'yes';
	if (target === 'geodata')
		return geoUpdateDone('geodata_mihomo', geo) || geoUpdateDone('geodata_singbox', geo);
	return false;
}

/* sing-box prefers local .srs; gen_singbox.sh falls back to remote CDN when absent */
function srsMode(geo) {
	geo = geo || {};
	var ip = geo.srs_geoip === 'yes', site = geo.srs_geosite === 'yes';
	if (ip && site) return 'local';
	if (ip || site) return 'partial';
	return 'remote';
}
function srsStatusText(mode) {
	if (mode === 'local') return _('SRS rule-sets ready (local)');
	if (mode === 'partial') return _('partial local — upload missing .srs for offline use');
	return _('using remote CDN (no local .srs)');
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

	coreCard: function () {
		return E('div', { 'class': 'tomfly-card tomfly-core-bar' }, [
			E('div', { 'class': 'tomfly-row tomfly-core-bar-row' }, [
				E('div', { 'class': 'tomfly-core-bar-main' }, [
					E('div', { 'class': 'tomfly-kernel-badge tomfly-ic-indigo tomfly-core-badge' }, 'T'),
					E('div', {}, [
						E('div', { 'class': 'tomfly-core-bar-title' }, 'TomFly'),
						E('div', { 'class': 'tomfly-muted tomfly-core-bar-desc' },
							_('Core scripts, LuCI UI & updater'))
					])
				]),
				E('button', {
					'class': 'cbi-button cbi-button-action important',
					'click': ui.createHandlerFn(this, 'handleUpdate', 'core')
				}, _('Update online'))
			])
		]);
	},

	geoCard: function (badge, cls, title, kernelLabel, files, version, ok, target, statusText) {
		return E('div', { 'class': 'tomfly-card tomfly-kernel tomfly-geo-card' }, [
			E('div', { 'class': 'tomfly-kernel-badge tomfly-ic-' + cls }, badge),
			E('div', { 'class': 'tomfly-kernel-name' }, title),
			E('div', { 'class': 'tomfly-kernel-sub' }, [
				E('span', { 'class': 'tomfly-muted' }, _('Kernel: ')),
				kernelLabel
			]),
			E('ul', { 'class': 'tomfly-geo-files' }, files.map(function (f) {
				return E('li', {}, [
					E('code', {}, f.name),
					' — ',
					f.desc
				]);
			})),
			E('div', { 'class': 'tomfly-kernel-ver' }, version ? (_('Updated: ') + version) : _('not installed')),
			E('div', { 'style': 'margin-bottom:10px' }, [
				E('span', { 'class': 'tomfly-pill ' + (ok ? 'tomfly-pill-on' : 'tomfly-pill-off') }, statusText)
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
		var geoDatOk = (geo.geoip === 'yes' && geo.geosite === 'yes');
		var srsModeVal = srsMode(geo);
		var geoSrsOk = (srsModeVal === 'local' || srsModeVal === 'remote' || srsModeVal === 'partial');
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

		var geoHint = _(
			'Each kernel uses different files — install only what you need, or both if you switch kernels.');

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
			this.coreCard(),
			E('div', { 'class': 'tomfly-kernel-section-head' }, [
				E('span', { 'class': 'tomfly-card-title tomfly-kernel-section-label' }, _('Kernels')),
				E('span', { 'class': 'tomfly-card-title tomfly-kernel-section-label' }, _('Geo Rules / GeoData')),
				E('span', { 'class': 'tomfly-section-hint', 'title': geoHint }, geoHint)
			]),
			E('div', { 'class': 'tomfly-grid-4' }, [
				this.kernelCard('M', 'blue', 'mihomo', mihomo.version, mihomo.installed, 'mihomo',
					mihomo.installed ? _('installed') : _('not installed')),
				this.kernelCard('S', 'red', 'sing-box', singbox.version, singbox.installed, 'singbox',
					singbox.installed ? _('installed') : _('not installed')),
				this.geoCard('G', 'blue', _('mihomo GeoData'), 'mihomo', [
					{ name: 'geoip.dat', desc: _('GeoIP CN rules') },
					{ name: 'geosite.dat', desc: _('GeoSite CN rules') }
				], geo.version, geoDatOk, 'geodata_mihomo',
					geoDatOk ? _('GeoIP + GeoSite ready') : _('missing geoip.dat / geosite.dat')),
				this.geoCard('R', 'red', _('sing-box Rule-Sets'), 'sing-box', [
					{ name: 'geoip-cn.srs', desc: _('GeoIP CN (local rule-set)') },
					{ name: 'geosite-cn.srs', desc: _('GeoSite CN (local rule-set)') }
				], geo.version, geoSrsOk, 'geodata_singbox',
					srsStatusText(srsModeVal))
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
		var label = target === 'core' ? 'TomFly' : target;
		return api.call('update_kernel', { target: target }).then(function () {
			ui.showModal(_('Updating ') + label, [
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
				if (target === 'core') {
					L.resolveDefault(api.call('get_logs', { lines: 80 }), {}).then(function (r) {
						var text = (r.lines || []).join('\n');
						if (/core update incomplete/i.test(text)) {
							window.clearInterval(poll);
							ui.hideModal();
							ui.addNotification(null, E('p', _('TomFly update failed — check the Logs tab')), 'danger');
							return;
						}
						if (/TomFly core updated/i.test(text)) {
							window.clearInterval(poll);
							ui.hideModal();
							notify(E('p', _('TomFly updated successfully — reload the page')), 5000);
							window.location.reload();
						}
					});
					return;
				}
				L.resolveDefault(api.call('get_kernels'), {}).then(function (k) {
					var geo = k.geodata || {};
					var info = k[target] || k[target === 'singbox' ? 'singbox' : target] || {};
					var done = (target === 'geodata_mihomo' || target === 'geodata_singbox' || target === 'geodata')
						? geoUpdateDone(target, geo)
						: !!info.installed;
					if (done) {
						window.clearInterval(poll);
						ui.hideModal();
						notify(E('p', label + ' ' + _('updated successfully')), 4000);
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
		var isGeoMihomo = target === 'geodata_mihomo';
		var isGeoSingbox = target === 'geodata_singbox';
		var isGeo = isGeoMihomo || isGeoSingbox || target === 'geodata';
		var kindSelect = null;

		if (isGeoMihomo) {
			kindSelect = E('select', {
				'class': 'cbi-input-select', 'id': 'tomfly-geodata-kind', 'style': 'width:100%;margin:8px 0'
			}, [
				E('option', { value: 'bundle' }, _('Both files (archive or upload twice)')),
				E('option', { value: 'geoip' }, 'geoip.dat'),
				E('option', { value: 'geosite' }, 'geosite.dat')
			]);
		} else if (isGeoSingbox) {
			kindSelect = E('select', {
				'class': 'cbi-input-select', 'id': 'tomfly-geodata-kind', 'style': 'width:100%;margin:8px 0'
			}, [
				E('option', { value: 'bundle' }, _('Both files (archive or upload twice)')),
				E('option', { value: 'geoip_srs' }, 'geoip-cn.srs'),
				E('option', { value: 'geosite_srs' }, 'geosite-cn.srs')
			]);
		} else if (target === 'geodata') {
			kindSelect = E('select', {
				'class': 'cbi-input-select', 'id': 'tomfly-geodata-kind', 'style': 'width:100%;margin:8px 0'
			}, [
				E('option', { value: 'bundle' }, _('All four files (.tar.gz)')),
				E('option', { value: 'geoip' }, 'mihomo: geoip.dat'),
				E('option', { value: 'geosite' }, 'mihomo: geosite.dat'),
				E('option', { value: 'geoip_srs' }, 'sing-box: geoip-cn.srs'),
				E('option', { value: 'geosite_srs' }, 'sing-box: geosite-cn.srs')
			]);
		}

		var fileInput = E('input', {
			'type': 'file',
			'accept': isGeo ? '.dat,.srs,.gz,.tar,.tar.gz,.tgz' : '.gz,.tar.gz,.tgz',
			'style': 'margin:10px 0'
		});

		var hint;
		if (isGeoMihomo) {
			hint = _('For mihomo only. Install to /etc/tomfly/geodata/: geoip.dat + geosite.dat. Source: Loyalsoldier/v2ray-rules-dat releases.');
		} else if (isGeoSingbox) {
			hint = _('For sing-box only. Install to /etc/tomfly/geodata/: geoip-cn.srs + geosite-cn.srs. Download from SagerNet/sing-geoip and sing-geosite (jsDelivr links in README).');
		} else if (isGeo) {
			hint = _('Mixed upload — pick the file type below.');
		} else if (target === 'singbox') {
			hint = _('Select the sing-box OpenWrt-compatible kernel archive (.gz or .tar.gz). On OpenWrt, use the -musl tarball or Update online.');
		} else {
			hint = _('Select the compressed kernel binary (.gz or .tar.gz)');
		}

		ui.showModal(_('Upload ') + target, [
			E('p', { 'class': 'tomfly-muted' }, hint),
			isGeoSingbox ? E('p', { 'class': 'tomfly-kernel-note' }, [
				E('strong', {}, 'geoip-cn.srs: '),
				'https://cdn.jsdelivr.net/gh/SagerNet/sing-geoip@rule-set/geoip-cn.srs',
				E('br'),
				E('strong', {}, 'geosite-cn.srs: '),
				'https://cdn.jsdelivr.net/gh/SagerNet/sing-geosite@rule-set/geosite-cn.srs'
			]) : '',
			kindSelect,
			fileInput,
			E('div', { 'class': 'right', 'style': 'margin-top:14px' }, [
				E('button', { 'class': 'cbi-button', 'click': ui.hideModal }, _('Cancel')),
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
						fd.append('filemode', '0600');
						fd.append('filedata', file);
						return request.post('/cgi-bin/cgi-upload', fd, {
							timeout: 120000
						}).then(function (res) {
							if (!res.ok)
								throw new Error(res.status === 404
									? 'cgi-io not available (apk add cgi-io)'
									: 'HTTP ' + res.status);
							var upload = res.json();
							if (upload && upload.failure)
								throw new Error(upload.message || 'cgi-io upload failed');
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
