// Progressive-enhancement runtime for a rendered menu.
// Plain, dependency-free JS: it runs inside the editor preview AND is inlined verbatim
// into exported HTML files (see core/exportHtml.ts), so it must stay self-contained.
// Everything works without it; it only adds motion, active-section tracking and language switching.

/**
 * @param {HTMLElement} container element that holds one or more [data-ma-root] menus
 * @param {{ scrollRoot?: Element | null, syncUrl?: boolean }} [options]
 */
export function initMenuRuntime(container, options) {
  var opts = options || {};
  var scrollRoot = opts.scrollRoot || null;
  var mql = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var finePointer = window.matchMedia ? window.matchMedia('(hover: hover) and (pointer: fine)').matches : false;
  var revealObserver = null;
  var navObserver = null;
  var tiltFrame = 0;

  function roots() {
    return Array.prototype.slice.call(container.querySelectorAll('[data-ma-root]'));
  }

  function motionReduced(root) {
    return (mql && mql.matches) || root.getAttribute('data-ma-motion') === 'reduced';
  }

  function setupReveal() {
    if (revealObserver) revealObserver.disconnect();
    var pending = Array.prototype.slice.call(container.querySelectorAll('.ma-reveal:not([data-ma-in])'));
    if (!('IntersectionObserver' in window)) {
      pending.forEach(function (el) { el.setAttribute('data-ma-in', ''); });
      return;
    }
    revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.setAttribute('data-ma-in', '');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { root: scrollRoot, rootMargin: '0px 0px -6% 0px', threshold: 0.05 });
    pending.forEach(function (el) { revealObserver.observe(el); });
  }

  function setupNav() {
    if (navObserver) navObserver.disconnect();
    if (!('IntersectionObserver' in window)) return;
    navObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var id = entry.target.id;
        var root = entry.target.closest('[data-ma-root]');
        if (!root) return;
        root.querySelectorAll('[data-ma-nav]').forEach(function (link) {
          var active = link.getAttribute('href') === '#' + id;
          if (active) {
            link.setAttribute('aria-current', 'true');
            var bar = link.closest('.ma-nav-list');
            if (bar && bar.scrollWidth > bar.clientWidth) {
              var target = link.offsetLeft - (bar.clientWidth - link.offsetWidth) / 2;
              bar.scrollTo({ left: target, behavior: motionReduced(root) ? 'auto' : 'smooth' });
            }
          } else {
            link.removeAttribute('aria-current');
          }
        });
      });
    }, { root: scrollRoot, rootMargin: '-35% 0px -60% 0px', threshold: 0 });
    container.querySelectorAll('.ma-section[id]').forEach(function (s) { navObserver.observe(s); });
  }

  function showLang(lang, focusSame) {
    var target = container.querySelector('[data-ma-lang-root="' + lang + '"]');
    if (!target) return false;
    var active = document.activeElement;
    var refocus = focusSame && active && active.getAttribute && active.getAttribute('data-ma-set-lang');
    container.querySelectorAll('[data-ma-lang-root]').forEach(function (el) {
      if (el === target) el.removeAttribute('hidden');
      else el.setAttribute('hidden', '');
    });
    if (opts.syncUrl) {
      document.documentElement.lang = lang;
      document.documentElement.dir = target.getAttribute('dir') || 'ltr';
      var title = target.getAttribute('data-ma-title');
      if (title) document.title = title;
      try {
        var url = new URL(window.location.href);
        url.searchParams.set('lang', lang);
        window.history.replaceState(null, '', url.toString());
      } catch (e) { /* file:// or sandboxed */ }
    }
    if (refocus) {
      var btn = target.querySelector('[data-ma-set-lang="' + refocus + '"]');
      if (btn) btn.focus();
    }
    setupReveal();
    setupNav();
    return true;
  }

  function onClick(event) {
    var el = event.target instanceof Element ? event.target : null;
    if (!el) return;
    var nav = el.closest('[data-ma-nav]');
    if (nav) {
      var id = (nav.getAttribute('href') || '').slice(1);
      var section = id ? container.querySelector('[id="' + id.replace(/"/g, '') + '"]') : null;
      if (section) {
        event.preventDefault();
        var root = section.closest('[data-ma-root]');
        section.scrollIntoView({ behavior: root && motionReduced(root) ? 'auto' : 'smooth', block: 'start' });
        var heading = section.querySelector('h2');
        if (heading) heading.focus({ preventScroll: true });
      }
      return;
    }
    var langBtn = el.closest('[data-ma-set-lang]');
    if (langBtn && langBtn.getAttribute('data-ma-runtime-lang') !== null) {
      showLang(langBtn.getAttribute('data-ma-set-lang'), true);
      return;
    }
    var motionBtn = el.closest('[data-ma-motion-toggle]');
    if (motionBtn) {
      var reduce = motionBtn.getAttribute('aria-pressed') !== 'true';
      roots().forEach(function (r) {
        if (reduce) r.setAttribute('data-ma-motion', 'reduced');
        else r.removeAttribute('data-ma-motion');
        r.querySelectorAll('[data-ma-motion-toggle]').forEach(function (b) {
          b.setAttribute('aria-pressed', reduce ? 'true' : 'false');
        });
      });
    }
  }

  var spotFrame = 0;
  function moveSpotlight(event) {
    var root = event.target instanceof Element ? event.target.closest('[data-ma-root].fx-spotlight') : null;
    if (!root || motionReduced(root)) return;
    if (spotFrame) cancelAnimationFrame(spotFrame);
    spotFrame = requestAnimationFrame(function () {
      var r = root.getBoundingClientRect();
      // Divide by the visual scale so it also works inside the scaled device preview.
      var scale = r.width / (root.offsetWidth || r.width);
      root.style.setProperty('--ma-sx', ((event.clientX - r.left) / scale).toFixed(0) + 'px');
      root.style.setProperty('--ma-sy', ((event.clientY - r.top) / scale).toFixed(0) + 'px');
    });
  }

  function onPointerMove(event) {
    if (!finePointer) return;
    moveSpotlight(event);
    var el = event.target instanceof Element ? event.target.closest('.fx-tilt .ma-item-inner') : null;
    if (!el) return;
    var root = el.closest('[data-ma-root]');
    if (!root || motionReduced(root)) return;
    if (tiltFrame) cancelAnimationFrame(tiltFrame);
    tiltFrame = requestAnimationFrame(function () {
      var r = el.getBoundingClientRect();
      var x = (event.clientX - r.left) / r.width;
      var y = (event.clientY - r.top) / r.height;
      el.style.setProperty('--ma-rx', ((0.5 - y) * 7).toFixed(2) + 'deg');
      el.style.setProperty('--ma-ry', ((x - 0.5) * 9).toFixed(2) + 'deg');
      el.style.setProperty('--ma-mx', (x * 100).toFixed(1) + '%');
      el.style.setProperty('--ma-my', (y * 100).toFixed(1) + '%');
    });
  }

  function onPointerOut(event) {
    var el = event.target instanceof Element ? event.target.closest('.ma-item-inner') : null;
    if (!el || (event.relatedTarget instanceof Node && el.contains(event.relatedTarget))) return;
    el.style.removeProperty('--ma-rx');
    el.style.removeProperty('--ma-ry');
  }

  roots().forEach(function (r) { r.setAttribute('data-ma-js', ''); });
  container.addEventListener('click', onClick);
  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerout', onPointerOut);

  if (opts.syncUrl) {
    var wanted = null;
    try { wanted = new URL(window.location.href).searchParams.get('lang'); } catch (e) { /* ignore */ }
    var available = Array.prototype.slice.call(container.querySelectorAll('[data-ma-lang-root]')).map(function (el) {
      return el.getAttribute('data-ma-lang-root');
    });
    if (!wanted || available.indexOf(wanted) === -1) {
      wanted = null;
      var prefs = navigator.languages || [navigator.language || ''];
      for (var i = 0; i < prefs.length && !wanted; i++) {
        var p = String(prefs[i]).toLowerCase();
        for (var j = 0; j < available.length; j++) {
          var a = available[j].toLowerCase();
          if (p === a || p.split('-')[0] === a.split('-')[0]) { wanted = available[j]; break; }
        }
      }
    }
    if (!wanted || !showLang(wanted, false)) { setupReveal(); setupNav(); }
  } else {
    setupReveal();
    setupNav();
  }

  return {
    refresh: function () {
      roots().forEach(function (r) { r.setAttribute('data-ma-js', ''); });
      setupReveal();
      setupNav();
    },
    destroy: function () {
      container.removeEventListener('click', onClick);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerout', onPointerOut);
      if (revealObserver) revealObserver.disconnect();
      if (navObserver) navObserver.disconnect();
      if (tiltFrame) cancelAnimationFrame(tiltFrame);
      if (spotFrame) cancelAnimationFrame(spotFrame);
    },
  };
}
