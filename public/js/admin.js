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
  };

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
    if (el.barSilence) {
      el.barSilence.style.width = (total ? ((tally.silence || 0) / total) * 100 : 0) + '%';
    }
    if (el.barSnitch) {
      el.barSnitch.style.width = (total ? ((tally.snitch || 0) / total) * 100 : 0) + '%';
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

      var when = document.createElement('td');
      when.className = 'muted small';
      when.textContent = v.created_at + ' UTC';

      tr.appendChild(name);
      tr.appendChild(choice);
      tr.appendChild(when);
      frag.appendChild(tr);
    });

    el.body.replaceChildren(frag);
    if (el.voteCount) el.voteCount.textContent = votes.length;
    if (el.empty) el.empty.classList.toggle('is-hidden', votes.length > 0);
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
    paintVotes(data.votes);

    if (data.type === 'reset') known = new Set();
  };

  window.addEventListener('beforeunload', function () { source.close(); });
})();
