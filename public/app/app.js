/* Twitch TTS dashboard — dependency-free. */
(function () {
  "use strict";

  var $ = function (id) {
    return document.getElementById(id);
  };

  // Fields that map 1:1 to the Settings model.
  var BOOLS = [
    "enabled",
    "readUsername",
    "stripUrls",
    "stripEmotes",
    "captionsEnabled",
  ];
  var NUMS = ["rate", "volume", "maxLength", "cooldownSeconds"];
  var STRS = [
    "channel",
    "triggerMode",
    "prefix",
    "roleGate",
    "voice",
    "blocklist",
    "ignoreList",
    "blocklistMode",
  ];

  function toast(msg, isErr) {
    var t = $("toast");
    t.textContent = msg;
    t.className = "toast show" + (isErr ? " err" : "");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () {
      t.className = "toast";
    }, 2600);
  }

  async function api(path, opts) {
    opts = opts || {};
    opts.credentials = "same-origin";
    opts.headers = Object.assign(
      { "content-type": "application/json" },
      opts.headers || {}
    );
    return fetch(path, opts);
  }

  // ── Settings form ↔ model ──
  function applySettings(s) {
    BOOLS.forEach(function (k) {
      $(k).checked = !!s[k];
    });
    NUMS.forEach(function (k) {
      $(k).value = s[k];
    });
    STRS.forEach(function (k) {
      if ($(k)) $(k).value = s[k] == null ? "" : s[k];
    });
    $("rate-val").textContent = Number(s.rate).toFixed(2) + "×";
    $("volume-val").textContent = Math.round(Number(s.volume) * 100) + "%";
    updatePrefixVisibility();
  }

  function collectSettings() {
    var out = {};
    BOOLS.forEach(function (k) {
      out[k] = $(k).checked;
    });
    NUMS.forEach(function (k) {
      out[k] = Number($(k).value);
    });
    STRS.forEach(function (k) {
      out[k] = $(k).value;
    });
    return out;
  }

  function updatePrefixVisibility() {
    $("prefix-field").style.display =
      $("triggerMode").value === "prefix" ? "" : "none";
  }

  async function loadVoices() {
    try {
      var r = await api("/api/voices");
      var data = await r.json();
      var sel = $("voice");
      sel.innerHTML = "";
      (data.voices || []).forEach(function (v) {
        var o = document.createElement("option");
        o.value = v;
        o.textContent = v;
        sel.appendChild(o);
      });
    } catch (e) {
      /* leave empty */
    }
  }

  async function loadSettings() {
    var r = await api("/api/settings");
    if (!r.ok) return;
    applySettings(await r.json());
  }

  async function saveSettings() {
    $("save-status").textContent = "Saving…";
    var r = await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify(collectSettings()),
    });
    if (r.ok) {
      applySettings(await r.json());
      $("save-status").textContent = "Saved";
      toast("Settings saved");
    } else {
      $("save-status").textContent = "Save failed";
      toast("Could not save settings", true);
    }
    setTimeout(function () {
      $("save-status").textContent = "";
    }, 2000);
  }

  // ── Controls ──
  async function sendTest() {
    var text = $("test-text").value.trim();
    if (!text) return;
    var r = await api("/api/actions/test", {
      method: "POST",
      body: JSON.stringify({ text: text }),
    });
    if (r.status === 409) {
      toast("Open your Browser Source URL first — no overlay is connected.", true);
    } else if (r.ok) {
      toast("Sent to overlay");
      $("test-text").value = "";
    } else {
      toast("Failed to send", true);
    }
  }

  async function action(path, okMsg) {
    var r = await api(path, { method: "POST" });
    toast(r.ok ? okMsg : "Action failed", !r.ok);
  }

  // ── Overlay URL ──
  async function regenToken() {
    if (
      !confirm(
        "Regenerate the overlay URL? Your current OBS source will stop working until you update it."
      )
    )
      return;
    var r = await api("/api/token/regenerate", { method: "POST" });
    if (r.ok) {
      var d = await r.json();
      $("overlay-url").value = d.overlayUrl;
      toast("New overlay URL generated");
    } else {
      toast("Failed to regenerate", true);
    }
  }

  function copyUrl() {
    var el = $("overlay-url");
    el.select();
    if (navigator.clipboard) {
      navigator.clipboard.writeText(el.value).then(
        function () {
          toast("Copied");
        },
        function () {
          document.execCommand("copy");
          toast("Copied");
        }
      );
    } else {
      document.execCommand("copy");
      toast("Copied");
    }
  }

  // ── Activity feed ──
  function pushActivity(entry) {
    var list = $("activity");
    var empty = list.querySelector(".empty");
    if (empty) empty.remove();
    var li = document.createElement("li");
    li.className = entry.type;
    var time = new Date(entry.time || Date.now());
    var hh = time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    var label =
      entry.type === "skip"
        ? "Skipped current message"
        : entry.type === "clear"
        ? "Cleared the queue"
        : null;
    if (label) {
      li.innerHTML = '<span class="a-time">' + hh + "</span>" + escapeHtml(label);
    } else {
      li.innerHTML =
        '<span class="a-time">' +
        hh +
        '</span><span class="a-name">' +
        escapeHtml(entry.name || "") +
        "</span> " +
        escapeHtml(entry.text || "");
    }
    list.insertBefore(li, list.firstChild);
    while (list.children.length > 50) list.removeChild(list.lastChild);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function connectActivity() {
    var proto = location.protocol === "https:" ? "wss" : "ws";
    var ws = new WebSocket(proto + "://" + location.host + "/ws/dashboard");
    ws.onmessage = function (ev) {
      try {
        var msg = JSON.parse(ev.data);
        if (msg.type === "activity") pushActivity(msg.entry);
      } catch (e) {}
    };
    ws.onclose = function () {
      setTimeout(connectActivity, 3000);
    };
    ws.onerror = function () {
      ws.close();
    };
  }

  // ── Wiring ──
  function wire(user) {
    $("whoami").textContent = "@" + user.login;
    $("overlay-url").value = user.overlayUrl;

    $("save").addEventListener("click", saveSettings);
    $("copy-url").addEventListener("click", copyUrl);
    $("regen-url").addEventListener("click", regenToken);
    $("test-send").addEventListener("click", sendTest);
    $("test-text").addEventListener("keydown", function (e) {
      if (e.key === "Enter") sendTest();
    });
    $("skip").addEventListener("click", function () {
      action("/api/actions/skip", "Skipped");
    });
    $("clear").addEventListener("click", function () {
      action("/api/actions/clear", "Queue cleared");
    });
    $("logout").addEventListener("click", async function () {
      await api("/auth/logout", { method: "POST" });
      location.reload();
    });
    $("triggerMode").addEventListener("change", updatePrefixVisibility);
    $("rate").addEventListener("input", function () {
      $("rate-val").textContent = Number($("rate").value).toFixed(2) + "×";
    });
    $("volume").addEventListener("input", function () {
      $("volume-val").textContent = Math.round(Number($("volume").value) * 100) + "%";
    });
  }

  function showLogin() {
    $("login").classList.remove("hidden");
  }

  async function init() {
    var me;
    try {
      me = await api("/api/me");
    } catch (e) {
      showLogin(); // API unreachable
      return;
    }
    if (!me.ok) {
      showLogin();
      return;
    }
    var user = await me.json();
    $("app").classList.remove("hidden");
    wire(user);
    await loadVoices();
    await loadSettings();
    connectActivity();
  }

  init();
})();
