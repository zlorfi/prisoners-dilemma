(function () {
  'use strict';

  var script = document.currentScript ||
    document.querySelector('script[data-stream]');
  if (!script) return;

  var streamUrl = script.getAttribute('data-stream');

  var el = {
    silence: document.getElementById('count-silence'),
    snitch: document.getElementById('count-snitch'),
    total: document.getElementById('count-total'),
    barSilence: document.getElementById('bar-silence'),
    barSnitch: document.getElementById('bar-snitch'),
    body: document.getElementById('votes-body'),
    empty: document.getElementById('votes-empty'),
    voteCount: document.getElementById('vote-count'),
    remaining: document.getElementById('remaining-names'),
    statusBadge: document.getElementById('status-badge'),
    dot: document.getElementById('live-dot'),
    label: document.getElementById('live-label'),
    verdictCard: document.getElementById('verdict-card'),
    pendingNote: document.getElementById('pending-note'),
    headline: document.getElementById('verdict-headline'),
    explanation: document.getElementById('verdict-explanation'),
    dmgSilence: document.getElementById('dmg-silence'),
    dmgSnitch: document.getElementById('dmg-snitch'),
    dmgTotal: document.getElementById('dmg-total'),
  };

  // Latest damage split, so the vote table can show a per-player figure.
  var currentDamage = null;

  /* ------------------------------------------------------------ copy link */

  var copyBtn = document.getElementById('copy-url');
  var urlInput = document.getElementById('share-url');
  if (copyBtn && urlInput) {
    copyBtn.addEventListener('click', function () {
      var done = function () {
        copyBtn.textContent = 'Copied';
        setTimeout(function () { copyBtn.textContent = 'Copy'; }, 1600);
      };
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(urlInput.value).then(done, fallback);
      } else {
        fallback();
      }
      function fallback() {
        urlInput.removeAttribute('readonly');
        urlInput.select();
        try { document.execCommand('copy'); done(); } catch (e) { /* ignore */ }
        urlInput.setAttribute('readonly', 'readonly');
        urlInput.blur();
      }
    });
  }

  /* ------------------------------------------------- destructive actions */

  /* Confirmations live here rather than in an inline onsubmit="", which the
     CSP (script-src-attr 'none') blocks. */
  Array.prototype.forEach.call(
    document.querySelectorAll('form[data-confirm]'),
    function (form) {
      form.addEventListener('submit', function (e) {
        if (!window.confirm(form.getAttribute('data-confirm'))) {
          e.preventDefault();
        }
      });
    },
  );

  /* --------------------------------------------------------------- render */

  function setConnection(state) {
    if (!el.dot || !el.label) return;
    el.dot.classList.toggle('is-live', state === 'live');
    el.dot.classList.toggle('is-down', state === 'down');
    el.label.textContent =
      state === 'live' ? 'live' : state === 'down' ? 'reconnecting…' : 'connecting…';
  }

  function paintTally(tally) {
    if (!tally) return;
    var total = tally.total || 0;
    if (el.silence) el.silence.textContent = tally.silence || 0;
    if (el.snitch) el.snitch.textContent = tally.snitch || 0;
    if (el.total) el.total.textContent = total;
    // setProperty on a custom property is CSP-safe; assigning style.width
    // directly would be blocked by `style-src 'self'`.
    if (el.barSilence) {
      el.barSilence.style.setProperty(
        '--pct',
        (total ? ((tally.silence || 0) / total) * 100 : 0) + '%',
      );
    }
    if (el.barSnitch) {
      el.barSnitch.style.setProperty(
        '--pct',
        (total ? ((tally.snitch || 0) / total) * 100 : 0) + '%',
      );
    }
  }

  // Track rendered ids so new arrivals can be highlighted without a full
  // re-render wiping the flash animation on every tick.
  var known = null;

  function paintVotes(votes) {
    if (!el.body) return;
    votes = votes || [];

    var incoming = votes.map(function (v) { return v.id; });
    var firstPaint = known === null;
    if (firstPaint) {
      known = new Set();
      // Seed from the server-rendered rows so they don't all flash on load.
      Array.prototype.forEach.call(el.body.children, function (_, i) {
        if (incoming[i] !== undefined) known.add(incoming[i]);
      });
    }

    var frag = document.createDocumentFragment();
    votes.forEach(function (v) {
      var tr = document.createElement('tr');
      if (!known.has(v.id)) {
        tr.className = 'is-new';
        known.add(v.id);
      }

      var name = document.createElement('td');
      name.textContent = v.display_name;

      var choice = document.createElement('td');
      var badge = document.createElement('span');
      badge.className = 'badge badge--' + v.choice;
      badge.textContent = v.choice;
      choice.appendChild(badge);

      var damage = document.createElement('td');
      damage.className = 'num strong';
      damage.textContent = currentDamage
        ? currentDamage[v.choice]
        : '\u2014';

      var when = document.createElement('td');
      when.className = 'muted small';
      when.textContent = v.created_at + ' UTC';

      tr.appendChild(name);
      tr.appendChild(choice);
      tr.appendChild(damage);
      tr.appendChild(when);
      frag.appendChild(tr);
    });

    el.body.replaceChildren(frag);
    if (el.voteCount) el.voteCount.textContent = votes.length;
    if (el.empty) el.empty.classList.toggle('is-hidden', votes.length > 0);
  }

  function paintVerdict(resolution) {
    currentDamage = resolution ? resolution.damage : null;

    if (el.verdictCard) el.verdictCard.classList.toggle('is-hidden', !resolution);
    if (el.pendingNote) el.pendingNote.classList.toggle('is-hidden', !!resolution);
    if (!resolution) return;

    if (el.headline) el.headline.textContent = resolution.headline;
    if (el.explanation) el.explanation.textContent = resolution.explanation;
    if (el.dmgSilence) el.dmgSilence.textContent = resolution.damage.silence;
    if (el.dmgSnitch) el.dmgSnitch.textContent = resolution.damage.snitch;
    if (el.dmgTotal) el.dmgTotal.textContent = resolution.totalDamage;
  }

  function paintStatus(data) {
    if (el.statusBadge && data.status) {
      el.statusBadge.textContent = data.status;
      el.statusBadge.className = 'badge badge--' + data.status;
    }
    if (el.remaining && typeof data.remainingNames === 'number') {
      el.remaining.textContent = data.remainingNames;
    }
  }

  /* ------------------------------------------------------------ streaming */

  if (!window.EventSource) {
    setConnection('down');
    return;
  }

  var source = new EventSource(streamUrl);

  source.onopen = function () { setConnection('live'); };
  source.onerror = function () { setConnection('down'); };

  source.onmessage = function (event) {
    var data;
    try {
      data = JSON.parse(event.data);
    } catch (e) {
      return;
    }

    if (data.type === 'deleted') {
      source.close();
      window.location.href = '/admin';
      return;
    }

    setConnection('live');
    paintStatus(data);
    paintTally(data.tally);
    // Before paintVotes: the damage column reads from the current split.
    paintVerdict(data.resolution);
    paintVotes(data.votes);

    if (data.type === 'reset') known = new Set();
  };

  window.addEventListener('beforeunload', function () { source.close(); });
})();
