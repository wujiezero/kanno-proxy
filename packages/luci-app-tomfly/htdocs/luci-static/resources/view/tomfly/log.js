'use strict';
'require view';
'require ui';
'require poll';
'require tomfly.api as api';

document.querySelector('head').appendChild(E('link', {
	'rel': 'stylesheet', 'type': 'text/css',
	'href': L.resource('view/tomfly/style.css')
}));

function notify(content, ms) {
	var el = ui.addNotification(null, content);
	if (ms > 0) window.setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, ms);
}

return view.extend({
	load: function () {
		return L.resolveDefault(api.call('get_logs', { lines: 200 }), { lines: [] });
	},

	render: function (r) {
		var lines = (r && r.lines) || [];
		var box = E('pre', { 'class': 'tomfly-log', 'id': 'tomfly-log' }, lines.join('\n') || _('(no log output)'));

		poll.add(function () {
			return L.resolveDefault(api.call('get_logs', { lines: 200 }), { lines: [] }).then(function (r) {
				var el = document.getElementById('tomfly-log');
				if (el) {
					var atBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) < 40;
					el.textContent = ((r && r.lines) || []).join('\n') || _('(no log output)');
					if (atBottom) el.scrollTop = el.scrollHeight;
				}
			});
		}, 5);

		return E('div', { 'class': 'tomfly' }, [
			E('div', { 'class': 'tomfly-row', 'style': 'margin-bottom:10px' }, [
				E('h3', { 'style': 'margin:0' }, _('Service Log')),
				E('button', {
					'class': 'cbi-button cbi-button-remove',
					'click': ui.createHandlerFn(this, 'handleClear')
				}, _('Clear Log'))
			]),
			E('div', { 'class': 'tomfly-card', 'style': 'padding:0;overflow:hidden' }, [box])
		]);
	},

	handleClear: function () {
		return api.call('clear_log').then(function () {
			var el = document.getElementById('tomfly-log');
			if (el) el.textContent = '';
			notify(E('p', _('Log cleared')), 2000);
		});
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
