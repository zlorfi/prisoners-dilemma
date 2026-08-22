(function () {
  'use strict';

  var script = document.currentScript ||
    document.querySelector('script[data-stream]');
  if (!script) return;

  var url = script.getAttribute('data-stream');
  var results = document.getElementById('results');
  var waiting = document.getElementById('waiting');

  var el = {
    silence: document.getElementById('count-silence'),
    snitch: document.getElementById('count-snitch'),
    total: document.getElementById('count-total'),
    barSilence: document.getElementById('bar-silence'),
    barSnitch: document.getElementById('bar-snitch'),
    verdict: document.getElementById('verdict'),
    headline: document.getElementById('verdict-headline'),
    explanation: document.getElementById('verdict-explanation'),
    damageBox: document.getElementById('damage-box'),
    damageValue: document.getElementById('damage-value'),
  };

  // Which side this player picked, so we can show their own damage.
  var myChoice = script.getAttribute('data-choice') || null;

  function paintVerdict(resolution) {
    if (!el.verdict) return;

    if (!resolution) {
      el.verdict.classList.add('is-hidden');
      return;
    }

    el.verdict.classList.remove('is-hidden');
    if (el.headline) el.headline.textContent = resolution.headline;
    if (el.explanation) el.explanation.textContent = resolution.explanation;

    if (el.damageValue && myChoice && resolution.damage) {
      var mine = resolution.damage[myChoice] || 0;
      el.damageValue.textContent = mine;
      if (el.damageBox) {
        el.damageBox.classList.toggle('damage--none', mine === 0);
      }
    }
  }

  function paint(tally) {
    if (!tally) return;
    var total = tally.total || 0;
    if (el.silence) el.silence.textContent = tally.silence || 0;
    if (el.snitch) el.snitch.textContent = tally.snitch || 0;
    if (el.total) el.total.textContent = total;

    var silencePct = total ? ((tally.silence || 0) / total) * 100 : 0;
    var snitchPct = total ? ((tally.snitch || 0) / total) * 100 : 0;
    // setProperty on a custom property is CSP-safe; assigning style.width
    // directly would be blocked by `style-src 'self'`.
    if (el.barSilence) el.barSilence.style.setProperty('--pct', silencePct + '%');
    if (el.barSnitch) el.barSnitch.style.setProperty('--pct', snitchPct + '%');
  }

  function setVisible(show) {
    if (results) results.classList.toggle('is-hidden', !show);
    if (waiting) waiting.classList.toggle('is-hidden', show);
  }

  // Server-rendered damage figure, so the first paint has the right colour.
  if (el.damageBox && el.damageValue) {
    el.damageBox.classList.toggle(
      'damage--none',
      Number(el.damageValue.textContent) === 0,
    );
  }

  // Render whatever was server-rendered before the socket opens.
  if (results && !results.classList.contains('is-hidden')) {
    paint({
      silence: Number(el.silence && el.silence.textContent) || 0,
      snitch: Number(el.snitch && el.snitch.textContent) || 0,
      total: Number(el.total && el.total.textContent) || 0,
    });
  }

  if (!window.EventSource) return;

  var source = new EventSource(url);

  source.onmessage = function (event) {
    var data;
    try {
      data = JSON.parse(event.data);
    } catch (e) {
      return;
    }
    if (data.type === 'deleted') {
      source.close();
      return;
    }
    // The stream carries no counts until the round resolves, so there is
    // simply nothing to show before then.
    setVisible(!!data.resolution);
    paintVerdict(data.resolution);
    if (data.resolution) {
      paint({
        silence: data.resolution.silence,
        snitch: data.resolution.snitch,
        total: data.resolution.total,
      });
    }
  };

  // EventSource reconnects on its own; nothing to do but stay quiet.
  source.onerror = function () {};
})();
