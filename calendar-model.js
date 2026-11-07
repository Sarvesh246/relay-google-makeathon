(function (root) {
  'use strict';

  var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var MONTH_OFFSETS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

  function pad(value, length) {
    return String(value).padStart(length || 2, '0');
  }

  function leapYear(year) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  }

  function daysInMonth(year, month) {
    if (month === 2) return leapYear(year) ? 29 : 28;
    return [4, 6, 9, 11].indexOf(month) >= 0 ? 30 : 31;
  }

  function parseMonth(value) {
    if (typeof value !== 'string' || value.length !== 7 || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
      throw new RangeError('Use a month in YYYY-MM format.');
    }
    var year = Number(value.slice(0, 4));
    if (year < 1) throw new RangeError('Choose a year between 0001 and 9999.');
    return { year: year, month: Number(value.slice(5, 7)) };
  }

  function parseDate(value) {
    if (typeof value !== 'string' || value.length !== 10 || !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) return null;
    var year = Number(value.slice(0, 4));
    var month = Number(value.slice(5, 7));
    var day = Number(value.slice(8, 10));
    if (year < 1 || day > daysInMonth(year, month)) return null;
    return { year: year, month: month, day: day };
  }

  function dateKey(date) {
    return pad(date.year, 4) + '-' + pad(date.month) + '-' + pad(date.day);
  }

  function validTime(time) {
    return typeof time === 'string' && time.length === 5 && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
  }

  function today(timeZone) {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone === undefined ? 'America/Chicago' : timeZone,
      calendar: 'iso8601',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date());
    var fields = {};
    parts.forEach(function (part) { fields[part.type] = part.value; });
    return fields.year.padStart(4, '0') + '-' + fields.month + '-' + fields.day;
  }

  function moveMonth(monthKey, delta) {
    var parsed = parseMonth(monthKey);
    if (!Number.isSafeInteger(delta)) throw new RangeError('Move by a whole number of months.');
    var index = (parsed.year - 1) * 12 + parsed.month - 1 + delta;
    if (!Number.isSafeInteger(index) || index < 0 || index >= 9999 * 12) {
      throw new RangeError('Choose a year between 0001 and 9999.');
    }
    return pad(Math.floor(index / 12) + 1, 4) + '-' + pad(index % 12 + 1);
  }

  function monthLabel(monthKey) {
    var parsed = parseMonth(monthKey);
    return MONTH_NAMES[parsed.month - 1] + ' ' + parsed.year;
  }

  function mondayIndex(year, month, day) {
    // January 1, 0001 was Monday in the proleptic Gregorian calendar.
    var previousYear = year - 1;
    var days = 365 * previousYear + Math.floor(previousYear / 4) - Math.floor(previousYear / 100) + Math.floor(previousYear / 400);
    days += MONTH_OFFSETS[month - 1] + day - 1;
    if (month > 2 && leapYear(year)) days += 1;
    return days % 7;
  }

  function nextDate(date) {
    date.day += 1;
    if (date.day > daysInMonth(date.year, date.month)) {
      date.day = 1;
      date.month += 1;
      if (date.month > 12) {
        date.month = 1;
        date.year += 1;
      }
    }
  }

  function compareEvents(left, right) {
    var leftTime = typeof left.time === 'string' ? left.time : '';
    var rightTime = typeof right.time === 'string' ? right.time : '';
    if (leftTime !== rightTime) return leftTime < rightTime ? -1 : 1;
    return String(left.title || '').localeCompare(String(right.title || ''), 'en');
  }

  function monthGrid(monthKey, events, todayISO) {
    var parsed = parseMonth(monthKey);
    var offset = mondayIndex(parsed.year, parsed.month, 1);
    var count = Math.ceil((offset + daysInMonth(parsed.year, parsed.month)) / 7) * 7;
    var cursor = { year: parsed.year, month: parsed.month, day: 1 };
    if (offset) {
      cursor.month -= 1;
      if (cursor.month === 0) {
        cursor.month = 12;
        cursor.year -= 1;
      }
      cursor.day = daysInMonth(cursor.year, cursor.month) - offset + 1;
    }
    var byDate = new Map();
    (Array.isArray(events) ? events : []).forEach(function (event) {
      if (!event || !parseDate(event.date)) return;
      if (!byDate.has(event.date)) byDate.set(event.date, []);
      byDate.get(event.date).push(event);
    });
    byDate.forEach(function (items) { items.sort(compareEvents); });
    var currentDate = todayISO === undefined ? today() : todayISO;
    var grid = [];
    for (var index = 0; index < count; index += 1) {
      if (cursor.year < 1 || cursor.year > 9999) throw new RangeError('This month extends beyond supported calendar years.');
      var key = dateKey(cursor);
      grid.push({
        date: key,
        day: cursor.day,
        inMonth: cursor.year === parsed.year && cursor.month === parsed.month,
        isToday: key === currentDate,
        events: byDate.get(key) || []
      });
      nextDate(cursor);
    }
    return grid;
  }

  function validateEvent(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return { valid: false, error: 'Add an event title and date.' };
    if (typeof input.title !== 'string' || !input.title.trim()) return { valid: false, error: 'Add an event title.' };
    var title = input.title.trim();
    if (title.length > 120) return { valid: false, error: 'Keep the title to 120 characters or fewer.' };
    var date = parseDate(input.date);
    if (!date || date.year < 1900 || date.year > 2100) return { valid: false, error: 'Choose a valid date between 1900 and 2100.' };
    var time = input.time === undefined ? '' : input.time;
    if (time !== '' && !validTime(time)) {
      return { valid: false, error: 'Choose a valid time in 24-hour HH:mm format.' };
    }
    var location = input.location === undefined ? '' : input.location;
    if (typeof location !== 'string') return { valid: false, error: 'Enter a location as text.' };
    location = location.trim();
    if (location.length > 160) return { valid: false, error: 'Keep the location to 160 characters or fewer.' };
    return { valid: true, error: '', event: { title: title, date: input.date, time: time, location: location } };
  }

  function formatTime(time) {
    if (!validTime(time)) return 'All day';
    var hour = Number(time.slice(0, 2));
    return (hour % 12 || 12) + ':' + time.slice(3) + (hour < 12 ? ' AM' : ' PM');
  }

  var api = Object.freeze({ today: today, moveMonth: moveMonth, monthLabel: monthLabel, monthGrid: monthGrid, validateEvent: validateEvent, formatTime: formatTime });
  root.RelayCalendar = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
