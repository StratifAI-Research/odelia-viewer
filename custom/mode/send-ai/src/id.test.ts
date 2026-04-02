import { id } from './id';

describe('send-ai mode', () => {
  it('exports a valid mode id', () => {
    expect(id).toBe('send-ai');
  });
});
