/* OBS Browser Source overlay: connects to the server, plays TTS audio in order,
   and shows optional captions. Receive-only WebSocket. */
(function () {
  "use strict";

  var params = new URLSearchParams(location.search);
  var token = params.get("token");

  var captionsEnabled = true;
  var volume = 1.0;

  var queue = []; // [{ url, caption }]
  var playing = false;
  var audio = new Audio();
  audio.preload = "auto";

  var captionEl = document.getElementById("caption");
  var captionName = captionEl.querySelector(".name");
  var captionText = captionEl.querySelector(".text");
  var enableEl = document.getElementById("enable");

  function clamp(n, lo, hi) {
    n = Number(n);
    if (isNaN(n)) return hi;
    return Math.max(lo, Math.min(hi, n));
  }

  function showCaption(cap) {
    if (!cap) return hideCaption();
    captionName.textContent = cap.name ? cap.name : "";
    captionText.textContent = cap.text || "";
    captionEl.classList.add("show");
  }
  function hideCaption() {
    captionEl.classList.remove("show");
  }

  function onDone() {
    audio.onended = null;
    audio.onerror = null;
    queue.shift();
    playing = false;
    processQueue();
  }

  function processQueue() {
    if (playing) return;
    var item = queue[0];
    if (!item) {
      hideCaption();
      return;
    }
    playing = true;
    audio.src = item.url;
    audio.volume = clamp(volume, 0, 1);
    if (captionsEnabled && item.caption) showCaption(item.caption);
    else hideCaption();

    audio.onended = onDone;
    audio.onerror = onDone;
    var p = audio.play();
    if (p && typeof p.catch === "function") {
      p.catch(function () {
        // Autoplay blocked (normal browser tab). Show the enable button and
        // leave the item at the front of the queue to retry after a click.
        audio.onended = null;
        audio.onerror = null;
        playing = false;
        enableEl.classList.add("show");
      });
    }
  }

  function skipCurrent() {
    audio.onended = null;
    audio.onerror = null;
    try {
      audio.pause();
    } catch (e) {}
    if (playing) queue.shift();
    playing = false;
    processQueue();
  }

  enableEl.addEventListener("click", function () {
    enableEl.classList.remove("show");
    processQueue();
  });

  function handle(msg) {
    switch (msg.type) {
      case "hello":
      case "config":
        captionsEnabled = !!msg.captionsEnabled;
        volume = clamp(msg.volume, 0, 1);
        if (!captionsEnabled) hideCaption();
        break;
      case "play":
        queue.push({ url: msg.url, caption: msg.caption });
        processQueue();
        break;
      case "skip":
        skipCurrent();
        break;
      case "clear":
        queue.length = 0;
        skipCurrent();
        hideCaption();
        break;
    }
  }

  function connect() {
    if (!token) {
      console.error("[overlay] missing ?token= in URL");
      return;
    }
    var proto = location.protocol === "https:" ? "wss" : "ws";
    var url = proto + "://" + location.host + "/ws/overlay?token=" + encodeURIComponent(token);
    var ws = new WebSocket(url);

    ws.onopen = function () {
      console.log("[overlay] connected");
    };
    ws.onmessage = function (ev) {
      try {
        handle(JSON.parse(ev.data));
      } catch (e) {
        console.error("[overlay] bad message", e);
      }
    };
    ws.onerror = function () {
      try {
        ws.close();
      } catch (e) {}
    };
    ws.onclose = function () {
      console.warn("[overlay] disconnected; retrying in 2s");
      setTimeout(connect, 2000);
    };
  }

  connect();
})();
