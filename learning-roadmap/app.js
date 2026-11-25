/* ============================================================
   Full-Stack Mastery Roadmap — rendering + progress
   ============================================================ */
(function () {
  "use strict";

  const $ = (s, r) => (r || document).querySelector(s);
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };

  /* ---------- storage (must never break the page) ---------- */
  const KEY = "fsroadmap.progress.v1";
  let done = {};
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) done = JSON.parse(raw) || {};
  } catch (e) { done = {}; }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(done)); } catch (e) { /* private mode */ }
  }

  const TOTAL_DAYS = WEEKS.length * 6;

  /* ---------- theme ---------- */
  const THEME_KEY = "fsroadmap.theme";
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t) document.documentElement.setAttribute("data-theme", t);
  } catch (e) {}
  $("#themeBtn").addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme");
    const isDark = cur
      ? cur === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
    const next = isDark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
  });

  /* ---------- phases ---------- */
  (function renderPhases() {
    const host = $("#phaseList");
    PHASES.forEach((p) => {
      const c = el("div", "phase");
      c.style.setProperty("--pc", p.c);
      c.innerHTML =
        '<div class="ph-top"><span class="num">PHASE ' + p.n + "</span>" +
        '<h3 style="font-size:17px">' + p.t + "</h3>" +
        '<span class="wk">' + p.w + "</span></div>" +
        "<p>" + p.d + "</p>" +
        '<div class="out"><b>You finish with:</b> ' + p.o + "</div>";
      host.appendChild(c);
    });
  })();

  /* ---------- timetable ---------- */
  const weekHost = $("#weekList");

  function updateProgress() {
    let n = 0;
    for (const k in done) if (done[k]) n++;
    const pct = Math.round((n / TOTAL_DAYS) * 100);
    $("#pbar").style.width = pct + "%";
    $("#ptext").textContent = n + " / " + TOTAL_DAYS;
    document.querySelectorAll(".week").forEach((w) => {
      const wn = w.dataset.week;
      let c = 0;
      for (let i = 1; i <= 6; i++) if (done["w" + wn + "d" + i]) c++;
      const badge = $(".wk-done", w);
      badge.textContent = c === 6 ? "done" : c + "/6";
      badge.style.color = c === 6 ? "var(--ok)" : "var(--muted)";
    });
  }

  (function renderWeeks() {
    WEEKS.forEach((w) => {
      const d = el("details", "week");
      d.dataset.week = w.n;
      d.dataset.phase = w.p;
      d.style.setProperty("--wc", w.c);

      const sum = el("summary");
      sum.innerHTML =
        '<span class="wk-no">W' + w.n + "</span>" +
        '<span class="wk-title">' + w.t + "</span>" +
        '<span class="wk-theme">' + w.th + "</span>" +
        '<span class="wk-done">0/6</span>';
      d.appendChild(sum);

      const body = el("div", "wk-body");
      w.d.forEach((day, i) => {
        const id = "w" + w.n + "d" + (i + 1);
        const row = el("div", "day" + (done[id] ? " checked" : ""));
        const cb = el("input");
        cb.type = "checkbox";
        cb.checked = !!done[id];
        cb.setAttribute("aria-label", "Week " + w.n + " day " + (i + 1) + " complete");
        cb.addEventListener("change", () => {
          done[id] = cb.checked;
          if (!cb.checked) delete done[id];
          row.classList.toggle("checked", cb.checked);
          save();
          updateProgress();
        });
        row.appendChild(cb);
        row.appendChild(el("span", "dno", "Day " + (i + 1)));
        row.appendChild(
          el("div", "dbody",
            '<div class="dt">' + day[0] + "</div>" +
            '<div class="dd">' + day[1] + "</div>")
        );
        body.appendChild(row);
      });

      const extra = el("div", "wk-extra");
      extra.innerHTML =
        '<div class="xbox"><b>Build</b>' + w.build + "</div>" +
        '<div class="xbox"><b>Revision</b>' + w.rev + "</div>" +
        '<div class="xbox"><b>Interview drill</b>' + w.iv + "</div>" +
        '<div class="xbox" style="border-color:var(--accent)"><b style="color:var(--accent)">Checkpoint</b>' + w.cp + "</div>";
      body.appendChild(extra);

      d.appendChild(body);
      weekHost.appendChild(d);
    });
    updateProgress();
  })();

  /* ---------- timetable filters ---------- */
  let phaseFilter = "all";
  let query = "";

  function applyFilter() {
    const q = query.trim().toLowerCase();
    document.querySelectorAll(".week").forEach((w) => {
      const okPhase = phaseFilter === "all" || w.dataset.phase === phaseFilter;
      const okText = !q || w.textContent.toLowerCase().indexOf(q) !== -1;
      w.style.display = okPhase && okText ? "" : "none";
      if (q && okPhase && okText) w.open = true;
    });
  }

  document.querySelectorAll(".chip[data-p]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".chip[data-p]").forEach((b) => b.classList.remove("on"));
      btn.classList.add("on");
      phaseFilter = btn.dataset.p;
      applyFilter();
    });
  });

  $("#ttSearch").addEventListener("input", (e) => {
    query = e.target.value;
    applyFilter();
  });

  let expanded = false;
  $("#expandAll").addEventListener("click", () => {
    expanded = !expanded;
    document.querySelectorAll(".week").forEach((w) => (w.open = expanded));
    $("#expandAll").textContent = expanded ? "Collapse all" : "Expand all";
  });

  $("#resetBtn").addEventListener("click", () => {
    if (!confirm("Clear all ticked days? This cannot be undone.")) return;
    done = {};
    save();
    document.querySelectorAll(".day input").forEach((cb) => {
      cb.checked = false;
      cb.closest(".day").classList.remove("checked");
    });
    updateProgress();
  });

  /* ---------- tracks ---------- */
  (function renderTracks() {
    const host = $("#trackList");
    TRACKS.forEach((t) => {
      const c = el("div", "track");
      c.style.setProperty("--tc", t.c);
      let lv = "";
      t.lv.forEach((l) => {
        lv += '<div class="lvl"><b>' + l.l + "</b><ul>" +
          l.i.map((x) => "<li>" + x + "</li>").join("") + "</ul></div>";
      });
      let wwh = '<div class="wwh">';
      t.wwh.forEach((p) => { wwh += "<div><b>" + p[0] + "</b>" + p[1] + "</div>"; });
      wwh += "</div>";
      c.innerHTML =
        '<div class="track-head"><h3>' + t.n +
        ' <span class="tag" style="background:' + t.c + ';color:#fff;border:0">' + t.w + "</span></h3>" +
        '<div class="why">' + t.why + "</div></div>" +
        '<div class="track-body">' + lv + wwh + "</div>";
      host.appendChild(c);
    });
  })();

  /* ---------- OOP ---------- */
  (function renderOop() {
    const host = $("#oopList");
    const grid = el("div", "grid g2");
    OOP.forEach((o) => {
      const c = el("div", "card");
      c.innerHTML =
        "<h3>" + o.t + '</h3><div style="font-size:12.5px;color:var(--c-oop);font-weight:600;margin-bottom:6px">' + o.s + "</div>" +
        "<p>" + o.b + "</p>" +
        '<div class="wwh" style="margin-top:8px"><div><b>Real-world</b>' + o.ex + "</div>" +
        '<div style="background:var(--danger-soft);border-color:transparent"><b>Common mistake</b>' + o.m + "</div></div>";
      grid.appendChild(c);
    });
    host.appendChild(grid);
  })();

  /* ---------- architectures ---------- */
  (function renderArch() {
    const host = $("#archList");
    ARCHS.forEach((a) => {
      const c = el("div", "arch");
      c.innerHTML =
        "<h3>" + a.t + ' <span class="tag a">' + a.tag + "</span></h3>" +
        '<div class="meta">' +
        "<div><b>What it is</b>" + a.what + "</div>" +
        "<div><b>Why it exists</b>" + a.why + "</div>" +
        "<div><b>When to use it</b>" + a.when + "</div>" +
        "</div>" +
        '<div class="pro-con">' +
        '<div class="pro"><b style="font-size:11px;letter-spacing:.09em;text-transform:uppercase">Advantages</b><ul>' +
        a.pros.map((x) => "<li>" + x + "</li>").join("") + "</ul></div>" +
        '<div class="con"><b style="font-size:11px;letter-spacing:.09em;text-transform:uppercase">Costs</b><ul>' +
        a.cons.map((x) => "<li>" + x + "</li>").join("") + "</ul></div>" +
        "</div>" +
        '<div style="margin-top:12px"><b style="font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted)">Typical structure</b>' +
        '<div class="flow" style="margin-top:4px">' + a.folder + "</div></div>" +
        '<div style="margin-top:10px"><b style="font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted)">Request / data flow</b>' +
        '<div class="flow" style="margin-top:4px">' + a.flow + "</div></div>" +
        '<div class="callout" style="margin-bottom:0"><b>Real example:</b> ' + a.real + "</div>";
      host.appendChild(c);
    });
  })();

  /* ---------- patterns ---------- */
  (function renderPatterns() {
    const host = $("#patternList");
    PATTERNS.forEach((g) => {
      const wrap = el("div", "card");
      wrap.style.marginBottom = "14px";
      let rows = "";
      g.items.forEach((p) => {
        rows +=
          "<tr><td style='width:180px'><b>" + p.n + "</b></td><td>" + p.p +
          "<div style='margin-top:4px;color:var(--muted)'><b style='color:var(--text-2)'>Use it for:</b> " + p.e + "</div></td></tr>";
      });
      wrap.innerHTML =
        "<h3>" + g.g + "</h3>" +
        '<div class="tbl-wrap"><table><thead><tr><th>Pattern</th><th>Problem it solves</th></tr></thead><tbody>' +
        rows + "</tbody></table></div>";
      host.appendChild(wrap);
    });
    const warn = el("div", "callout d");
    warn.innerHTML =
      "<b>The rule that matters more than the catalogue:</b> a pattern is a response to a pressure you are already feeling. " +
      "Applied before the pressure exists, it is speculative generality &mdash; more indirection, more files, more cognitive load, and no benefit. " +
      "In a code review, &ldquo;I used Strategy because we now have a third tax rule and the switch statement was being edited for every one&rdquo; is a senior justification. " +
      "&ldquo;I used Strategy because it is a design pattern&rdquo; is not.";
    host.appendChild(warn);
  })();

  /* ---------- projects ---------- */
  (function renderProjects() {
    const host = $("#projectList");
    PROJECTS.forEach((p) => {
      const c = el("div", "card");
      c.style.marginBottom = "14px";
      c.style.borderTop = "3px solid " + p.c;
      c.innerHTML =
        '<h3>' + p.t + ' <span class="tag" style="background:' + p.c + ';color:#fff;border:0">' + p.tag + "</span></h3>" +
        '<div class="wwh" style="margin-top:10px"><div><b>Stack</b>' + p.stack + "</div>" +
        "<div><b>Architecture &amp; why</b>" + p.arch + "</div></div>" +
        '<div style="margin-top:12px"><b style="font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted)">Scope</b>' +
        '<ul style="font-size:14px;margin-top:4px">' + p.feat.map((f) => "<li>" + f + "</li>").join("") + "</ul></div>" +
        '<div class="callout" style="margin-bottom:0"><b>What this actually teaches you:</b> ' + p.learn + "</div>";
      host.appendChild(c);
    });
  })();

  /* ---------- checkpoints ---------- */
  (function renderCheckpoints() {
    const host = $("#checkpointList");
    const grid = el("div", "grid g2");
    CHECKPOINTS.forEach((cp) => {
      const c = el("div", "card");
      c.style.borderTop = "3px solid " + cp.c;
      c.innerHTML =
        "<h3 style='font-size:16px'>" + cp.ph + "</h3><ul style='font-size:14px;margin-top:8px'>" +
        cp.i.map((x) => "<li>" + x + "</li>").join("") + "</ul>";
      grid.appendChild(c);
    });
    host.appendChild(grid);
  })();

  /* ---------- interview ---------- */
  (function renderInterview() {
    const host = $("#interviewList");
    INTERVIEW.forEach((g) => {
      const h = el("h3");
      h.style.cssText = "margin:20px 0 8px;font-size:16px;color:" + g.c;
      h.textContent = g.g;
      host.appendChild(h);
      g.q.forEach((qa) => {
        const d = el("details", "qa");
        d.innerHTML = "<summary>" + qa[0] + '</summary><div class="ans">' + qa[1] + "</div>";
        host.appendChild(d);
      });
    });
  })();

  /* ---------- mistakes ---------- */
  (function renderMistakes() {
    const host = $("#mistakeList");
    const grid = el("div", "grid g2");
    MISTAKES.forEach((g) => {
      const c = el("div", "card");
      c.style.borderTop = "3px solid " + g.c;
      let rows = "";
      g.i.forEach((m) => {
        rows += '<li style="margin-bottom:8px"><b style="color:var(--danger)">' + m[0] + "</b><br>" +
          '<span style="font-size:13.6px;color:var(--text-2)">' + m[1] + "</span></li>";
      });
      c.innerHTML = "<h3 style='font-size:16px'>" + g.g + '</h3><ul style="margin-top:8px;list-style:none;padding-left:0">' + rows + "</ul>";
      grid.appendChild(c);
    });
    host.appendChild(grid);
  })();

  /* ---------- scroll spy ---------- */
  (function spy() {
    const links = Array.prototype.slice.call(document.querySelectorAll(".sidenav a"));
    const map = {};
    links.forEach((a) => { map[a.getAttribute("href").slice(1)] = a; });
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            links.forEach((a) => a.classList.remove("on"));
            const a = map[e.target.id];
            if (a) a.classList.add("on");
          }
        });
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 }
    );
    document.querySelectorAll("main section").forEach((s) => obs.observe(s));
  })();
})();
