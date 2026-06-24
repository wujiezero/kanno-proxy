'use strict';
'require baseclass';

/*
 * TomFly — shared UI kit for the native LuCI views.
 * Provides the pill navigation, an inline-SVG icon factory and a few small
 * components (type badge, latency pill, toggle switch) so the redesigned
 * views stay DRY. Pure presentation — no API or business logic lives here.
 */

/* The seven views, in nav order. Keys match the menu.d paths; labels mirror the
   Chinese titles defined in menu.d/luci-app-tomfly.json so the pill nav reads
   exactly like LuCI's native tab strip it replaces. */
var NAV = [
	['overview', '概览'],
	['nodes',    '节点'],
	['groups',   '分组'],
	['rules',    '规则'],
	['dns',      'DNS'],
	['kernel',   '内核'],
	['log',      '日志']
];

/* Inner SVG markup, lifted from the design mock. Stroke icons by default;
   a couple are filled (see FILLED). */
var ICONS = {
	swap:   '<path d="M17 4l3 3-3 3"/><path d="M20 7H8"/><path d="M7 20l-3-3 3-3"/><path d="M4 17h12"/>',
	up:     '<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>',
	down:   '<path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/>',
	link:   '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
	mem:    '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
	clock:  '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
	info:   '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
	warn:   '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
	bolt:   '<path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z"/>',
	plus:   '<path d="M12 5v14M5 12h14"/>',
	check:  '<path d="M20 6L9 17l-5-5"/>',
	edit:   '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
	power:  '<path d="M18.36 6.64A9 9 0 1 1 5.64 6.64"/><path d="M12 2v10"/>',
	trash:  '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
	dots:   '<circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/>',
	close:  '<path d="M6 6l12 12M18 6L6 18"/>',
	search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/>',
	upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 16v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/>',
	file:   '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
	refresh:'<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>'
};
var FILLED = { dots: 1 };

var SIDEBAR = '#mainmenu, #menubar, .sidebar, .main-left';
function hideNativeTabs() {
	/* Class-based: the node tab strip. Never touch anything inside the sidebar. */
	var i, els = document.querySelectorAll('ul.tabs, ul.cbi-tabmenu, .cbi-tabmenu');
	for (i = 0; i < els.length; i++)
		if (!els[i].closest(SIDEBAR)) els[i].style.display = 'none';
	/* Fallback for themes that name the strip differently: a <ul> in the main
	   content whose links mostly point at our own views. Scoped to #maincontent
	   and excluding the sidebar so the section submenu is never hidden. */
	var main = document.querySelector('#maincontent');
	if (!main) return;
	var uls = main.querySelectorAll('ul');
	for (i = 0; i < uls.length; i++) {
		if (uls[i].closest(SIDEBAR)) continue;
		if (uls[i].querySelectorAll('a[href*="services/tomfly"]').length >= 4)
			uls[i].style.display = 'none';
	}
}

/* Client-side tab switch: load the target view module and swap the .tomfly-app
   content in place — no full page reload. Falls back to a normal navigation on
   any error, so it can never be worse than the stock multi-page behaviour.
   URL is kept in sync via pushState so refresh / bookmark / back all work. */
var _navigating = false;
function softNav(key, push) {
	if (_navigating) return;
	var url = L.url('admin/services/tomfly/' + key);
	_navigating = true;
	var done = function () { _navigating = false; };
	var fail = function () { _navigating = false; window.location.href = url; };
	try {
		return L.require('view.tomfly.' + key).then(function (mod) {
			var inst = (mod && typeof mod.render === 'function') ? mod : new mod();
			return Promise.resolve(inst.load ? inst.load() : null).then(function (data) {
				var node = inst.render(data);
				var cur = document.querySelector('.tomfly-app');
				if (!node || !cur || !cur.parentNode) return fail();
				cur.parentNode.replaceChild(node, cur);
				if (push !== false) { try { history.pushState({ tfTab: key }, '', url); } catch (e) {} }
				try { window.scrollTo(0, 0); } catch (e) {}
				done();
			}).catch(fail);
		}).catch(fail);
	} catch (e) { fail(); }
}

return baseclass.extend({
	NAV: NAV,

	/* Inject the stylesheet once, flag the page and hide LuCI's stock tab
	   strip (we render our own pill nav). Call from each view module body. */
	mount: function () {
		if (!document.getElementById('tomfly-style'))
			document.querySelector('head').appendChild(E('link', {
				'id': 'tomfly-style', 'rel': 'stylesheet', 'type': 'text/css',
				'href': L.resource('view/tomfly/style.css')
			}));
		document.body.classList.add('tomfly-page');
		hideNativeTabs();
		window.setTimeout(hideNativeTabs, 0);
		window.setTimeout(hideNativeTabs, 200);
		/* Back/forward between soft-navigated tabs (registered once). */
		if (!window.__tomflyPop) {
			window.__tomflyPop = true;
			window.addEventListener('popstate', function () {
				var m = location.pathname.match(/services\/tomfly\/([a-z]+)/);
				if (m) softNav(m[1], false);
			});
		}
	},

	/* Inline SVG element from the ICONS map. */
	icon: function (name, size) {
		var s = size || 18;
		var filled = FILLED[name];
		var span = E('span', { 'class': 'tomfly-i' });
		span.innerHTML = '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" ' +
			(filled
				? 'fill="currentColor" stroke="none"'
				: 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"') +
			'>' + (ICONS[name] || '') + '</svg>';
		return span.firstChild;
	},

	/* Pill navigation bar. `right` is optional trailing content (e.g. a kernel
	   badge). Links are real hrefs — navigation stays multi-page. */
	nav: function (active, right) {
		var pills = NAV.map(function (it) {
			return E('a', {
				'class': 'tomfly-navpill' + (it[0] === active ? ' active' : ''),
				'href': L.url('admin/services/tomfly/' + it[0]),
				'click': function (ev) {
					/* let ctrl/cmd/middle-click open a real new tab */
					if (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.button) return;
					if (it[0] === active) { ev.preventDefault(); return; }
					ev.preventDefault();
					softNav(it[0]);
				}
			}, it[1]);
		});
		var rightKids = [E('img', {
			'class': 'tomfly-nav-logo', 'src': L.resource('view/tomfly/logo.png'),
			'alt': 'TomFly', 'title': 'TomFly'
		})];
		if (right) rightKids = rightKids.concat(right);
		return E('div', { 'class': 'tomfly-nav' }, [
			E('div', { 'class': 'tomfly-navpills' }, pills),
			E('div', { 'class': 'tomfly-nav-right' }, rightKids)
		]);
	},

	/* Section banner (info / warn accent). */
	banner: function (kind, children) {
		return E('div', { 'class': 'tomfly-banner ' + (kind || 'info') }, [
			this.icon(kind === 'warn' ? 'warn' : 'info', 18),
			E('div', { 'class': 'tomfly-banner-text' }, children)
		]);
	},

	/* Protocol type badge, coloured per scheme. */
	typeBadge: function (type) {
		var t = (type || '').toLowerCase();
		return E('span', { 'class': 'tomfly-type tomfly-type-' + (t || 'x') },
			(type || '?').toUpperCase());
	},

	/* Latency pill. ms falsy → muted dash. */
	latPill: function (ms) {
		var cls = 'none', txt = '—';
		if (ms) {
			txt = ms + ' ms';
			cls = ms < 150 ? 'good' : (ms < 400 ? 'ok' : 'bad');
		}
		return E('span', { 'class': 'tomfly-lat tomfly-lat-' + cls }, txt);
	},

	/* iOS-style toggle. Renders a hidden checkbox (#id) so existing save
	   handlers can keep reading `.checked`. */
	toggle: function (id, checked) {
		var input = E('input', { 'type': 'checkbox', 'id': id, 'class': 'tomfly-switch-input' });
		input.checked = !!checked;
		var track = E('span', { 'class': 'tomfly-switch' + (checked ? ' on' : '') }, [
			E('span', { 'class': 'tomfly-switch-knob' })
		]);
		track.addEventListener('click', function () {
			input.checked = !input.checked;
			track.classList.toggle('on', input.checked);
		});
		return E('div', { 'class': 'tomfly-switch-wrap' }, [input, track]);
	}
});
