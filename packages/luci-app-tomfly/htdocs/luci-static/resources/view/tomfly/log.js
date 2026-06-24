'use strict';
'require view';
'require ui';
'require poll';
'require dom';
'require tomfly.api as api';
'require tomfly.widgets as widgets';

widgets.mount();

function notify(content, ms) {
	var el = ui.addNotification(null, content);
	if (ms > 0) window.setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, ms);
}

/* Module-scoped state so it stays consistent across soft-nav re-renders
   (instances may differ; the once-registered poll must see the same data). */
var _lines = [], _level = 'all', _search = '', _logPollAdded = false;

/* Best-effort split of a raw log line into time / level / message. Detection
   failures fall back to showing the whole line as the message, so the viewer
   never looks broken regardless of the kernel's log format. */
function parseLine(line) {
	var rest = line;
	var time = '';
	var tm = rest.match(/(?:\d{4}-\d{2}-\d{2}[ T])?(\d{2}:\d{2}:\d{2})/);
	if (tm && rest.indexOf(tm[0]) < 30) {
		time = tm[1];
		rest = rest.replace(tm[0], '').trim();
	}
	var level = '';
	var lm = rest.match(/\b(INFORMATION|INFO|INF|WARNING|WARN|WRN|ERROR|ERRO|ERR|FATAL|DEBUG|DBG)\b/i);
	if (lm) {
		var L0 = lm[1].toUpperCase();
		if (L0.indexOf('INF') === 0) level = 'INFO';
		else if (L0.indexOf('WAR') === 0 || L0 === 'WRN') level = 'WARN';
		else if (L0.indexOf('ERR') === 0 || L0 === 'FATAL') level = 'ERROR';
		else level = 'DEBUG';
		rest = rest.replace(lm[0], '').replace(/^[\s:|\]\[-]+/, '').trim();
	}
	return { time: time, level: level, msg: rest || line };
}

function buildRows() {
	var rows = [];
	var q = (_search || '').toLowerCase();
	(_lines || []).filter(Boolean).forEach(function (line) {
		var p = parseLine(line);
		if (_level !== 'all' && p.level !== _level) return;
		if (q && line.toLowerCase().indexOf(q) < 0) return;
		rows.push(E('div', { 'class': 'tomfly-log-row' }, [
			E('span', { 'class': 'tomfly-log-time' }, p.time || '·'),
			p.level
				? E('span', { 'class': 'tomfly-log-lvl ' + p.level.toLowerCase() }, p.level)
				: E('span', { 'class': 'tomfly-log-lvl debug', 'style': 'visibility:hidden' }, '—'),
			E('span', { 'class': 'tomfly-log-msg' }, p.msg)
		]));
	});
	return rows;
}

function applyRows(keepScroll) {
	var body = document.getElementById('tomfly-log-body');
	if (!body) return;
	var atBottom = (body.scrollHeight - body.scrollTop - body.clientHeight) < 40;
	var rows = buildRows();
	dom.content(body, rows.length ? rows : E('div', { 'class': 'tomfly-log-empty' }, _('(no log output)')));
	var cnt = document.getElementById('tomfly-log-count');
	if (cnt) cnt.textContent = _('%d lines').format(rows.length);
	if (keepScroll && atBottom) body.scrollTop = body.scrollHeight;
}

return view.extend({
	load: function () {
		return L.resolveDefault(api.call('get_logs', { lines: 200 }), { lines: [] });
	},

	setLevel: function (lvl) {
		_level = lvl;
		var pills = document.querySelectorAll('#tomfly-log-filters .tomfly-filter');
		for (var i = 0; i < pills.length; i++)
			pills[i].classList.toggle('active', pills[i].getAttribute('data-lvl') === lvl);
		applyRows(false);
	},

	render: function (r) {
		var self = this;
		_lines = (r && r.lines) || [];
		_search = '';
		if (_level !== 'INFO' && _level !== 'WARN' && _level !== 'ERROR') _level = 'all';

		var filters = E('div', { 'class': 'tomfly-filters', 'id': 'tomfly-log-filters' },
			[['all', _('All')], ['INFO', 'INFO'], ['WARN', 'WARN'], ['ERROR', 'ERROR']].map(function (f) {
				return E('div', {
					'class': 'tomfly-filter' + (f[0] === _level ? ' active' : ''), 'data-lvl': f[0],
					'click': function () { self.setLevel(f[0]); }
				}, f[1]);
			}));

		var searchInput = E('input', { 'type': 'text', 'placeholder': _('Search logs…') });
		searchInput.addEventListener('input', function () { _search = this.value; applyRows(false); });

		var body = E('div', { 'class': 'tomfly-log-body', 'id': 'tomfly-log-body' });

		if (!_logPollAdded) {
			_logPollAdded = true;
			poll.add(function () {
				if (!document.getElementById('tomfly-log-body')) return;  // tab not mounted
				return L.resolveDefault(api.call('get_logs', { lines: 200 }), { lines: [] }).then(function (r) {
					_lines = (r && r.lines) || [];
					applyRows(true);
				});
			}, 5);
		}

		var root = E('div', { 'class': 'tomfly-app' }, [
			widgets.nav('log'),
			E('div', { 'class': 'tomfly-log-bar' }, [
				filters,
				E('div', { 'class': 'tomfly-actions' }, [
					E('div', { 'class': 'tomfly-search' }, [widgets.icon('search', 15), searchInput]),
					E('button', { 'class': 'tomfly-btn tomfly-btn-ghost', 'click': ui.createHandlerFn(this, 'handleClear') },
						[widgets.icon('trash', 15), _('Clear')])
				])
			]),
			E('div', { 'class': 'tomfly-card tomfly-log-card' }, [
				E('div', { 'class': 'tomfly-log-head' }, [
					E('div', { 'class': 'tomfly-log-title' }, [
						E('span', { 'class': 'tomfly-dot', 'style': 'background:var(--tf-success);animation:tomfly-pulse 1.8s ease-in-out infinite' }),
						_('Service Log')
					]),
					E('span', { 'class': 'tomfly-muted', 'id': 'tomfly-log-count' }, '')
				]),
				body
			])
		]);

		/* fill rows after the node is in the DOM */
		window.setTimeout(function () { applyRows(true); }, 0);
		return root;
	},

	handleClear: function () {
		return api.call('clear_log').then(function () {
			_lines = [];
			applyRows(false);
			notify(E('p', _('Log cleared')), 2000);
		});
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
