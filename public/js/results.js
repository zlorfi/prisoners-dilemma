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
  };

  function paint(tally) {
    if (!tally) return;
    var total = tally.total || 0;
    if (el.silence) el.silence.textContent = tally.silence || 0;
    if (el.snitch) el.snitch.textContent = tally.snitch || 0;
    if (el.total) el.total.textContent = total;

    var silencePct = total ? ((tally.silence || 0) / total) * 100 : 0;
    var snitchPct = total ? ((tally.snitch || 0) / total) * 100 : 0;
    if (el.barSilence) el.barSilence.style.width = silencePct + '%';
    if (el.barSnitch) el.barSnitch.style.width = snitchPct + '%';
  }

  function setVisible(show) {
    if (results) results.classList.toggle('is-hidden', !show);
    if (waiting) waiting.classList.toggle('is-hidden', show);
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
    setVisible(!!data.showResults);
    if (data.showResults) paint(data.tally);
  };

  // EventSource reconnects on its own; nothing to do but stay quiet.
  source.onerror = function () {};
})();
