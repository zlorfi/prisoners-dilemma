(function () {
  'use strict';

  var form = document.getElementById('vote-form');
  var submit = document.getElementById('submit');
  var reroll = document.getElementById('reroll');
  var nameInput = document.getElementById('name');

  function readCookie(name) {
    return document.cookie.split('; ').reduce(function (acc, part) {
      var i = part.indexOf('=');
      return part.slice(0, i) === name ? decodeURIComponent(part.slice(i + 1)) : acc;
    }, '');
  }

  /* Ask the server for a different alias. The server owns the reservation,
     so we never pick a name locally. */
  if (reroll && nameInput) {
    reroll.addEventListener('click', function () {
      reroll.disabled = true;
      fetch(window.location.pathname + '/suggest-name', {
        method: 'POST',
        headers: {
          'x-csrf-token': readCookie('pd_csrf'),
          Accept: 'application/json',
        },
        credentials: 'same-origin',
      })
        .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
        .then(function (res) {
          if (res.ok && res.body.name) {
            nameInput.value = res.body.name;
            nameInput.focus();
            nameInput.setSelectionRange(nameInput.value.length, nameInput.value.length);
          }
        })
        .catch(function () { /* offline — keep the current name */ })
        .finally(function () { reroll.disabled = false; });
    });
  }

  /* Guard against a double submit creating confusion; the server enforces
     one-vote-per-device regardless, this is purely cosmetic. */
  if (form && submit) {
    form.addEventListener('submit', function (e) {
      var chosen = form.querySelector('input[name="choice"]:checked');
      if (!chosen) {
        e.preventDefault();
        var box = form.querySelector('.choices');
        if (box) {
          box.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return;
      }
      submit.disabled = true;
      submit.textContent = 'Submitting…';
      // Re-enable if the browser restores the page from bfcache.
      window.addEventListener('pageshow', function () {
        submit.disabled = false;
        submit.textContent = 'Confirm my decision';
      });
    });
  }
})();
