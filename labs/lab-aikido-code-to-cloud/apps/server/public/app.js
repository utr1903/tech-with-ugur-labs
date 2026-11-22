(function () {
  var loginView = document.getElementById("login-view");
  var chatView = document.getElementById("chat-view");
  var loginForm = document.getElementById("login-form");
  var loginError = document.getElementById("login-error");
  var chatForm = document.getElementById("chat-form");
  var messages = document.getElementById("messages");
  var typing = document.getElementById("typing");
  var customerLabel = document.getElementById("customer-id");

  // tiny markdown subset: **bold**, "- "/"* " lists, newlines. Does NOT escape HTML.
  function renderMarkdown(text) {
    var out = [];
    var inList = false;
    String(text).split("\n").forEach(function (line) {
      var m = /^\s*[-*] (.*)$/.exec(line);
      var html = function (t) { return t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>"); };
      if (m) {
        if (!inList) { out.push("<ul>"); inList = true; }
        out.push("<li>" + html(m[1]) + "</li>");
      } else {
        if (inList) { out.push("</ul>"); inList = false; }
        // no <br> after table structure tags (it would be hoisted above the table)
        var structural = /^\s*<\/?(table|thead|tbody|tr|th|td)[\s>]/i.test(line);
        out.push(html(line) + (structural ? "" : "<br>"));
      }
    });
    if (inList) out.push("</ul>");
    return out.join("");
  }

  function addBubble(role, text, plain) {
    var bubble = document.createElement("div");
    bubble.className = "bubble " + role;
    if (role === "assistant" && !plain) {
      // INSECURE-BY-DESIGN: model output rendered with innerHTML (DOM XSS via prompt injection)
      bubble.innerHTML = renderMarkdown(text);
    } else {
      bubble.textContent = text;
    }
    messages.appendChild(bubble);
    messages.scrollTop = messages.scrollHeight;
  }

  function setBusy(busy) {
    document.getElementById("message").disabled = busy;
    chatForm.querySelector("button").disabled = busy;
  }

  function showLogin() {
    chatView.hidden = true;
    loginView.hidden = false;
  }

  function showChat() {
    loginView.hidden = true;
    chatView.hidden = false;
    customerLabel.textContent = localStorage.getItem("paybuddy.customerId") || "";
  }

  function logout() {
    localStorage.clear();
    typing.hidden = true;
    setBusy(false);
    messages.innerHTML = "";
    showLogin();
  }

  loginForm.addEventListener("submit", function (ev) {
    ev.preventDefault();
    loginError.textContent = "";
    fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: document.getElementById("username").value,
        password: document.getElementById("password").value,
      }),
    })
      .then(function (res) {
        return res.json().then(function (body) { return { ok: res.ok, body: body }; });
      })
      .then(function (r) {
        if (!r.ok) {
          loginError.textContent = r.body.error || "login failed";
          return;
        }
        // INSECURE-BY-DESIGN: JWT kept in localStorage, readable by any XSS
        localStorage.setItem("paybuddy.token", r.body.token);
        localStorage.setItem("paybuddy.customerId", r.body.customerId);
        localStorage.removeItem("paybuddy.sessionId");
        showChat();
      })
      .catch(function () { loginError.textContent = "network error"; });
  });

  chatForm.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var input = document.getElementById("message");
    var text = input.value.trim();
    if (!text) return;
    input.value = "";
    addBubble("user", text);
    typing.hidden = false;
    setBusy(true);
    var sentToken = localStorage.getItem("paybuddy.token");
    var payload = { message: text };
    var sessionId = localStorage.getItem("paybuddy.sessionId");
    if (sessionId) payload.sessionId = sessionId;
    fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + sentToken,
      },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        return res.json().then(function (body) { return { status: res.status, ok: res.ok, body: body }; });
      })
      .then(function (r) {
        if (localStorage.getItem("paybuddy.token") !== sentToken) return;
        typing.hidden = true;
        setBusy(false);
        if (r.status === 401) {
          logout();
          loginError.textContent = "session expired, please sign in again";
          return;
        }
        if (!r.ok) {
          var msg = r.body.error || "something went wrong";
          if (r.body.details) msg += ": " + String(r.body.details).split("\n")[0];
          addBubble("assistant", msg, true);
          return;
        }
        localStorage.setItem("paybuddy.sessionId", r.body.sessionId);
        addBubble("assistant", r.body.reply);
      })
      .catch(function () {
        if (localStorage.getItem("paybuddy.token") !== sentToken) return;
        typing.hidden = true;
        setBusy(false);
        addBubble("assistant", "network error", true);
      });
  });

  document.getElementById("logout").addEventListener("click", logout);

  if (localStorage.getItem("paybuddy.token")) showChat();
  else showLogin();
})();
