/* COPY of sites/_shared/chassis/when.js — edit the source there and run node _shared/sync.mjs */
/* Dates in words, the same in every app: uiDate.

   Source: sites/_shared/chassis/when.js (copied into each app with the chassis by node _shared/sync.mjs).
   From the behaviour audit of 21 Nov 2026 (briefs/same-job-audit.html): about 25 apps' worth of fmtDate,
   dayLabel, whenLabel, relWhen, timeAgo, agoText and inline toLocaleDateString calls, each a little
   different. Built from Life Kanban's dayLabel, House Book's whenLabel, Diary's relWhen and Content Hub's
   whenText. Always British (en-GB), always plain words.

   Load as a plain script (<script src="vendor/chassis/when.js"></script>), or import it once for its side
   effect in a bundled app (import './vendor/chassis/when.js'). Then:

     uiDate.day('2026-06-03')          "3 Jun"          (adds the year when it isn't this year: "3 Jun 2025")
     uiDate.day(d, { weekday: true })  "Wed 3 Jun"
     uiDate.long('2026-06-03')         "Wednesday 3 June 2026"
     uiDate.range('2026-03-12', '2026-03-14')  "12–14 Mar"   ("28 Feb – 3 Mar", "30 Dec 2026 – 2 Jan 2027")
     uiDate.label(d)                   "Today", "Tomorrow", "Yesterday", else "Thu 6 Nov"   (a day heading)
     uiDate.rel(d)                     "Today", "Tomorrow", "in 3 days", "3 days ago", else uiDate.day   (a due date)
     uiDate.ago(time)                  "just now", "5 min ago", "3 hours ago", "yesterday", "4 days ago", else "3 Jun"
     uiDate.when(time)                 "Today 14:05", "Yesterday 09:30", "Tue 18:00", else "3 Oct"   (a log line)
     uiDate.time(time)                 "14:05"
     uiDate.today()                    "2026-11-21" (this device's day, not UTC's)
     uiDate.addDays('2026-11-21', 7)   "2026-11-28"
     uiDate.daysFrom(d)                whole days from today: 0 today, 1 tomorrow, -1 yesterday

   Every function takes a date as "YYYY-MM-DD" (read as that day here, never shifted by time zone), an ISO
   time, a Date or a number of milliseconds, and an optional `now` last (for tests). Anything it can't read
   comes back as ''. */
(function (g) {
  'use strict';
  if (g.uiDate) return;
  const DAY = 86400000;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const pad = (n) => String(n).padStart(2, '0');

  // A plain day ("2026-06-03") is that day at midnight here; anything else goes through Date.
  function parse(x) {
    if (x == null || x === '') return null;
    if (x instanceof Date) return isNaN(x) ? null : x;
    if (typeof x === 'number') return new Date(x);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(x).trim());
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    const d = new Date(x);
    return isNaN(d) ? null : d;
  }
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const nowOf = (now) => parse(now) || new Date();
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  function daysFrom(x, now) {
    const d = parse(x); if (!d) return null;
    return Math.round((startOf(d) - startOf(nowOf(now))) / DAY);
  }
  function day(x, opts, now) {
    opts = opts || {};
    const d = parse(x); if (!d) return '';
    const year = opts.year === true || (opts.year !== false && d.getFullYear() !== nowOf(now).getFullYear());
    return `${opts.weekday ? WD[d.getDay()] + ' ' : ''}${d.getDate()} ${MON[d.getMonth()]}${year ? ' ' + d.getFullYear() : ''}`;
  }
  function long(x) {
    const d = parse(x); if (!d) return '';
    return `${WEEKDAY[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]} ${d.getFullYear()}`;
  }
  function range(a, b, now) {
    const s = parse(a), e = parse(b);
    if (!s) return '';
    if (!e || startOf(s) === startOf(e)) return day(s, {}, now);
    const yr = nowOf(now).getFullYear();
    const showYear = s.getFullYear() !== e.getFullYear() || s.getFullYear() !== yr;
    if (s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth())
      return `${s.getDate()}–${e.getDate()} ${MON[e.getMonth()]}${showYear ? ' ' + e.getFullYear() : ''}`;
    if (s.getFullYear() === e.getFullYear())
      return `${s.getDate()} ${MON[s.getMonth()]} – ${e.getDate()} ${MON[e.getMonth()]}${showYear ? ' ' + e.getFullYear() : ''}`;
    return `${day(s, { year: true })} – ${day(e, { year: true })}`;
  }
  function label(x, now) {
    const n = daysFrom(x, now); if (n == null) return '';
    if (n === 0) return 'Today';
    if (n === 1) return 'Tomorrow';
    if (n === -1) return 'Yesterday';
    return day(x, { weekday: true }, now);
  }
  function rel(x, now) {
    const n = daysFrom(x, now); if (n == null) return '';
    if (n === 0) return 'Today';
    if (n === 1) return 'Tomorrow';
    if (n === -1) return 'Yesterday';
    if (n > 1 && n < 14) return `in ${n} days`;
    if (n < -1 && n > -14) return `${-n} days ago`;
    return day(x, {}, now);
  }
  function ago(x, now) {
    const d = parse(x); if (!d) return '';
    const ms = nowOf(now).getTime() - d.getTime();
    if (ms < 0) return rel(x, now);
    const min = Math.floor(ms / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min} min ago`;
    const days = daysFrom(x, now);
    if (days === 0) { const h = Math.floor(min / 60); return h === 1 ? '1 hour ago' : `${h} hours ago`; }
    if (days === -1) return 'yesterday';
    if (days > -14) return `${-days} days ago`;
    return day(x, {}, now);
  }
  function time(x) {
    const d = parse(x); if (!d) return '';
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function when(x, now) {
    const d = parse(x); if (!d) return '';
    const n = daysFrom(x, now);
    if (n === 0) return `Today ${time(d)}`;
    if (n === -1) return `Yesterday ${time(d)}`;
    if (n === 1) return `Tomorrow ${time(d)}`;
    if (n > -7 && n < 7) return `${WD[d.getDay()]} ${time(d)}`;
    return day(d, {}, now);
  }
  const today = (now) => iso(nowOf(now));
  function addDays(x, n) {
    const d = parse(x); if (!d) return '';
    return iso(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
  }

  g.uiDate = { parse, daysFrom, day, long, range, label, rel, ago, when, time, today, addDays, iso: (x) => { const d = parse(x); return d ? iso(d) : ''; } };
})(typeof window !== 'undefined' ? window : globalThis);
