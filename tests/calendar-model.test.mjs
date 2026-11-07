import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const calendar = require('../calendar-model.js');
const source = readFileSync(new URL('../calendar-model.js', import.meta.url), 'utf8');

function event(overrides = {}) {
  return { title: 'Team dinner', date: '2026-11-07', time: '18:00', location: 'The neighborhood cafe', ...overrides };
}

function calendarAt(instant) {
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [instant])); }
    static now() { return new RealDate(instant).getTime(); }
  }
  const context = { Date: FixedDate, Intl };
  runInNewContext(source, context);
  return context.RelayCalendar;
}

test('the same helper works as a Node module and a browser global', () => {
  assert.equal(globalThis.RelayCalendar, calendar);
  const browser = {};
  runInNewContext(source, browser);
  assert.deepEqual(Object.keys(browser.RelayCalendar), Object.keys(calendar));
  assert.equal(browser.RelayCalendar.monthLabel('2026-11'), 'November 2026');
});

test('month navigation crosses year boundaries and handles larger jumps', () => {
  assert.equal(calendar.moveMonth('2026-12', 1), '2027-01');
  assert.equal(calendar.moveMonth('2026-01', -1), '2025-12');
  assert.equal(calendar.moveMonth('2026-11', 15), '2028-02');
  assert.equal(calendar.moveMonth('2026-11', -24), '2024-11');
  assert.equal(calendar.moveMonth('2026-11', 0), '2026-11');
  assert.equal(calendar.moveMonth('0099-12', 1), '0100-01');
  assert.equal(calendar.monthLabel('2000-02'), 'February 2000');
  for (const month of ['2026-1', '26-11', '2026-00', '2026-13', '2026-11-01', ' 2026-11', '2026-11\n', '0000-01', null]) {
    assert.throws(() => calendar.moveMonth(month, 1), RangeError);
    assert.throws(() => calendar.monthLabel(month), RangeError);
    assert.throws(() => calendar.monthGrid(month, [], ''), RangeError);
  }
  for (const delta of [0.5, '1', NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => calendar.moveMonth('2026-11', delta), RangeError);
  }
});

test('Monday-first grids use the minimum number of full weeks and adjacent dates', () => {
  const november = calendar.monthGrid('2026-11', [], '2026-11-07');
  assert.equal(november.length, 42);
  assert.equal(november[0].date, '2026-10-26');
  assert.equal(november.at(-1).date, '2026-12-06');
  assert.equal(november.filter(day => day.inMonth).length, 30);
  assert.deepEqual(november.filter(day => day.isToday).map(day => day.date), ['2026-11-07']);
  assert.equal(november.find(day => day.date === '2026-10-31').inMonth, false);
  assert.equal(november.find(day => day.date === '2026-11-01').day, 1);

  const fourWeeks = calendar.monthGrid('2021-02', [], '2021-02-15');
  assert.equal(fourWeeks.length, 28);
  assert.equal(fourWeeks[0].date, '2021-02-01');
  assert.equal(fourWeeks.at(-1).date, '2021-02-28');
  assert.ok(fourWeeks.every(day => day.inMonth));

  const fiveWeeks = calendar.monthGrid('2026-06', [], '2026-05-31');
  assert.equal(fiveWeeks.length, 35);
  assert.equal(fiveWeeks[0].date, '2026-06-01');
  assert.equal(fiveWeeks.at(-1).date, '2026-07-05');
  assert.ok(fiveWeeks.every(day => !day.isToday));
});

test('grids include leap days and cross December and January without rollover errors', () => {
  const leap = calendar.monthGrid('2024-02', [], '2024-02-29');
  assert.equal(leap.length, 35);
  assert.equal(leap.filter(day => day.inMonth).length, 29);
  assert.equal(leap.find(day => day.date === '2024-02-29').isToday, true);
  assert.equal(calendar.monthGrid('1900-02', [], '').filter(day => day.inMonth).length, 28);
  assert.equal(calendar.monthGrid('2000-02', [], '').filter(day => day.inMonth).length, 29);
  assert.equal(calendar.monthGrid('2100-02', [], '').filter(day => day.inMonth).length, 28);
  assert.equal(calendar.monthGrid('2027-01', [], '')[0].date, '2026-12-28');
  assert.equal(calendar.monthGrid('2026-12', [], '').at(-1).date, '2027-01-03');
});

test('event grouping preserves objects and orders all-day events, time, then title', () => {
  const later = event({ id: 'later', title: 'Afternoon', time: '15:00', planIndex: 2 });
  const zebra = event({ id: 'zebra', title: 'Zebra', time: '09:00' });
  const alpha = event({ id: 'alpha', title: 'Alpha', time: '09:00' });
  const allDay = event({ id: 'all-day', title: 'All-day event', time: '' });
  const adjacent = event({ id: 'adjacent', date: '2026-10-31' });
  const outside = event({ id: 'outside', date: '2027-01-01' });
  const input = [later, zebra, alpha, allDay, adjacent, outside];
  const grid = calendar.monthGrid('2026-11', input, '2026-10-31');
  const day = grid.find(item => item.date === '2026-11-07');
  assert.deepEqual(day.events, [allDay, alpha, zebra, later]);
  assert.equal(day.events[3], later);
  assert.equal(day.events[3].planIndex, 2);
  assert.deepEqual(input, [later, zebra, alpha, allDay, adjacent, outside]);
  const adjacentDay = grid.find(item => item.date === '2026-10-31');
  assert.deepEqual(adjacentDay.events, [adjacent]);
  assert.equal(adjacentDay.inMonth, false);
  assert.equal(adjacentDay.isToday, true);
  assert.ok(!grid.some(item => item.events.includes(outside)));
  assert.ok(grid.some(item => item.events.length === 0));
});

test('event validation accepts real boundary dates and trims text without mutating input', () => {
  const input = event({ title: '  Lunch with neighbors  ', location: '  Main Street  ', extra: 'ignored' });
  assert.deepEqual(calendar.validateEvent(input), {
    valid: true, error: '', event: { title: 'Lunch with neighbors', date: '2026-11-07', time: '18:00', location: 'Main Street' }
  });
  assert.equal(input.title, '  Lunch with neighbors  ');
  for (const date of ['1900-01-01', '2000-02-29', '2024-02-29', '2100-12-31']) {
    assert.equal(calendar.validateEvent(event({ date })).valid, true, date);
  }
  assert.deepEqual(calendar.validateEvent({ title: 'Birthday', date: '2026-11-07' }).event, {
    title: 'Birthday', date: '2026-11-07', time: '', location: ''
  });
  assert.equal(calendar.validateEvent(event({ title: 'x'.repeat(120), location: 'y'.repeat(160) })).valid, true);
});

test('event validation rejects impossible dates, century leap errors, and loose date formats', () => {
  for (const date of [
    '1900-02-29', '2100-02-29', '2026-02-29', '2024-02-30', '2026-04-31', '2026-11-31',
    '2026-00-10', '2026-13-10', '2026-11-00', '2026-11-32', '1899-12-31', '2101-01-01',
    '2026-1-07', '2026-11-7', '2026-11-07T00:00:00Z', ' 2026-11-07', '2026-11-07\n', '', null, 20261107
  ]) {
    const result = calendar.validateEvent(event({ date }));
    assert.equal(result.valid, false, String(date));
    assert.match(result.error, /date/);
    assert.equal(result.event, undefined);
  }
});

test('event validation rejects missing, excessive, or incorrectly typed fields', () => {
  for (const input of [undefined, null, [], 'event', {}, event({ title: '' }), event({ title: ' \t\n ' }), event({ title: 42 }), event({ title: 'x'.repeat(121) }), event({ location: 'x'.repeat(161) }), event({ location: null })]) {
    const result = calendar.validateEvent(input);
    assert.equal(result.valid, false);
    assert.ok(result.error);
    assert.equal(result.event, undefined);
  }
  for (const time of ['24:00', '12:60', '9:00', '09:0', '18:00:00', '6:00 PM', ' 09:00', '09:00\n', null, 900]) {
    assert.equal(calendar.validateEvent(event({ time })).valid, false, String(time));
  }
  for (const time of ['', '00:00', '09:05', '12:00', '23:59']) {
    assert.equal(calendar.validateEvent(event({ time })).valid, true, time);
  }
});

test('time labels handle midnight, noon, and all-day events', () => {
  assert.equal(calendar.formatTime('00:00'), '12:00 AM');
  assert.equal(calendar.formatTime('09:05'), '9:05 AM');
  assert.equal(calendar.formatTime('12:00'), '12:00 PM');
  assert.equal(calendar.formatTime('18:00'), '6:00 PM');
  assert.equal(calendar.formatTime('23:59'), '11:59 PM');
  for (const time of ['', undefined, null, '24:00', '09:00\n', 'invalid']) assert.equal(calendar.formatTime(time), 'All day');
});

test('today follows Chicago midnight and daylight-saving transitions, independent of UTC date', () => {
  assert.equal(calendarAt('2026-11-07T05:59:59Z').today(), '2026-11-06');
  assert.equal(calendarAt('2026-11-07T06:00:00Z').today(), '2026-11-07');
  assert.equal(calendarAt('2026-03-08T07:59:59Z').today(), '2026-03-08');
  assert.equal(calendarAt('2026-03-08T08:00:00Z').today(), '2026-03-08');
  assert.equal(calendarAt('2026-03-09T04:59:59Z').today(), '2026-03-08');
  assert.equal(calendarAt('2026-03-09T05:00:00Z').today(), '2026-03-09');
  assert.equal(calendarAt('2026-11-01T06:59:59Z').today(), '2026-11-01');
  assert.equal(calendarAt('2026-11-01T07:00:00Z').today(), '2026-11-01');
  assert.equal(calendarAt('2027-01-01T01:00:00Z').today(), '2026-12-31');
  assert.equal(calendarAt('2027-01-01T01:00:00Z').today('Asia/Tokyo'), '2027-01-01');
  assert.equal(calendarAt('2027-01-01T01:00:00Z').today('UTC'), '2027-01-01');
});

test('date grids remain identical across host time zones and DST', () => {
  const helperPath = require.resolve('../calendar-model.js');
  const script = `const c = require(process.argv[1]); console.log(JSON.stringify(['2026-03','2026-11','2027-01'].map(month => c.monthGrid(month, [], '2026-11-01'))));`;
  const outputs = ['UTC', 'America/Chicago', 'Pacific/Honolulu', 'Asia/Tokyo'].map(TZ => execFileSync(process.execPath, ['-e', script, helperPath], { env: { ...process.env, TZ }, encoding: 'utf8' }));
  assert.ok(outputs.every(output => output === outputs[0]));
  const [march, november] = JSON.parse(outputs[0]);
  assert.equal(new Set(march.map(day => day.date)).size, march.length);
  assert.equal(new Set(november.map(day => day.date)).size, november.length);
  assert.deepEqual(march.filter(day => day.inMonth).map(day => day.day), Array.from({ length: 31 }, (_, i) => i + 1));
  assert.deepEqual(november.filter(day => day.inMonth).map(day => day.day), Array.from({ length: 30 }, (_, i) => i + 1));
});
