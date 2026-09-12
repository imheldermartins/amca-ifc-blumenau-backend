import { describe, expect, it } from 'vitest';
import { resolveRqliteAuthorization, resolveRqliteUrl } from './raft_url.js';

describe('resolveRqliteUrl', () => {
  it('prioriza e normaliza RQLITE_URL', () => {
    expect(resolveRqliteUrl({
      RQLITE_URL: 'https://rqlite.example.com:8443/',
      RQLITE_ADVERTISE_IP: 'legacy-host',
      RQLITE_PORT: '9999',
    })).toBe('https://rqlite.example.com:8443');
  });

  it('mantem compatibilidade com host e porta antigos', () => {
    expect(resolveRqliteUrl({
      RQLITE_ADVERTISE_IP: 'rqlite',
      RQLITE_PORT: '4001',
    })).toBe('http://rqlite:4001');
  });

  it('usa localhost:8000 quando nenhuma configuracao existe', () => {
    expect(resolveRqliteUrl({})).toBe('http://localhost:8000');
  });

  it.each([
    'tcp://rqlite.example.com:4001',
    'https://user:secret@rqlite.example.com',
    'https://rqlite.example.com/prefix',
    'https://rqlite.example.com/path?token=secret',
  ])('rejeita URL inadequada: %s', value => {
    expect(() => resolveRqliteUrl({ RQLITE_URL: value })).toThrow('RQLITE_URL');
  });
});

describe('resolveRqliteAuthorization', () => {
  it('gera Basic Auth quando o par esta completo', () => {
    expect(resolveRqliteAuthorization({
      RQLITE_USERNAME: 'backend',
      RQLITE_PASSWORD: 'secret',
    })).toBe(`Basic ${Buffer.from('backend:secret').toString('base64')}`);
  });

  it('nao envia Authorization quando o par esta vazio', () => {
    expect(resolveRqliteAuthorization({})).toBeUndefined();
  });

  it('rejeita credencial parcial', () => {
    expect(() => resolveRqliteAuthorization({ RQLITE_USERNAME: 'backend' }))
      .toThrow('RQLITE_USERNAME e RQLITE_PASSWORD');
  });
});
