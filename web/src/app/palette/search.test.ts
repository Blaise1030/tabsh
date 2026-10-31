import assert from 'node:assert/strict';
import { test } from 'node:test';
import { itemMatches, parseQuery, RECENT_SESSIONS, recentFirst, sessionMatches, visit } from './search.ts';

test('a search is trimmed and lowercased', () => {
  assert.deepEqual(parseQuery('  Login  '), { sessionsOnly: false, term: 'login' });
  assert.deepEqual(parseQuery(''), { sessionsOnly: false, term: '' });
});

test('a leading > narrows the search to sessions', () => {
  assert.deepEqual(parseQuery('>login'), { sessionsOnly: true, term: 'login' });
  assert.deepEqual(parseQuery('  > Login '), { sessionsOnly: true, term: 'login' });
  assert.deepEqual(parseQuery('>'), { sessionsOnly: true, term: '' });
});

test('the > prefix is only read where it is offered', () => {
  assert.deepEqual(parseQuery('>login', false), { sessionsOnly: false, term: '>login' });
});

test('a setting matches its label or a keyword, as Basecoat does', () => {
  const theme = { label: 'Theme…', keywords: 'color colour scheme dark light' };
  assert.equal(itemMatches(theme, parseQuery('the')), true);
  assert.equal(itemMatches(theme, parseQuery('dark')), true);
  assert.equal(itemMatches(theme, parseQuery('')), true);
  assert.equal(itemMatches(theme, parseQuery('font')), false);
});

test('only sessions show with the > prefix', () => {
  const theme = { label: 'Theme…', keywords: '' };
  assert.equal(itemMatches(theme, parseQuery('>')), false);
  assert.equal(itemMatches(theme, parseQuery('>the')), false);
});

const login = { title: 'Fix login bug', cwd: '/Users/jo/code/webapp', note: 'ask Sam about tokens', rank: 7 };

test('a session matches part of its title', () => {
  assert.equal(sessionMatches(login, parseQuery('login')), true);
  assert.equal(sessionMatches(login, parseQuery('fix log')), true);
  assert.equal(sessionMatches(login, parseQuery('LOGIN')), true);
  assert.equal(sessionMatches(login, parseQuery('signup')), false);
});

test('a session also matches its folder name or its note', () => {
  assert.equal(sessionMatches(login, parseQuery('webapp')), true);
  assert.equal(sessionMatches(login, parseQuery('tokens')), true);
  // Only the folder's own name, not every folder above it.
  assert.equal(sessionMatches(login, parseQuery('users')), false);
});

test('with the > prefix a session matches by title only', () => {
  assert.equal(sessionMatches(login, parseQuery('>login')), true);
  assert.equal(sessionMatches(login, parseQuery('>webapp')), false);
  assert.equal(sessionMatches(login, parseQuery('>tokens')), false);
});

test('an empty search shows only the most recent sessions', () => {
  const at = (rank: number) => ({ title: 't', cwd: null, note: null, rank });
  assert.equal(sessionMatches(at(0), parseQuery('')), true);
  assert.equal(sessionMatches(at(RECENT_SESSIONS - 1), parseQuery('')), true);
  assert.equal(sessionMatches(at(RECENT_SESSIONS), parseQuery('')), false);
});

test('a lone > lists every session', () => {
  assert.equal(sessionMatches({ ...login, rank: 40 }, parseQuery('>')), true);
});

const card = (id: string, statusAt: number, archived = false) => ({ id, statusAt, archived });

test('sessions visited last come first, the one on screen after the others', () => {
  const cards = [card('a', 10), card('b', 20), card('c', 30), card('d', 40)];
  // Visited in order a, c, b (b last); b is on screen.
  const order = recentFirst(cards, ['b', 'c', 'a'], 'b').map((c) => c.id);
  assert.deepEqual(order, ['c', 'a', 'd', 'b']);
});

test('sessions never visited follow, the latest status change first', () => {
  const cards = [card('a', 10), card('b', 30), card('c', 20)];
  assert.deepEqual(
    recentFirst(cards, [], null).map((c) => c.id),
    ['b', 'c', 'a'],
  );
});

test('archived sessions come last, even when visited', () => {
  const cards = [card('a', 10), card('old', 50, true), card('b', 20)];
  assert.deepEqual(
    recentFirst(cards, ['old', 'a'], null).map((c) => c.id),
    ['a', 'b', 'old'],
  );
});

test('a visit moves the session to the front, once', () => {
  assert.deepEqual(visit([], 'a'), ['a']);
  assert.deepEqual(visit(['b', 'a', 'c'], 'a'), ['a', 'b', 'c']);
  const many = Array.from({ length: 200 }, (_, i) => `s${i}`);
  assert.equal(visit(many, 'new').length, 100);
  assert.equal(visit(many, 'new')[0], 'new');
});
